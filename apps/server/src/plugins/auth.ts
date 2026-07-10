/**
 * Session auth: opaque 32-byte token in an HttpOnly SameSite=Lax cookie;
 * only its sha256 is stored. 30-day sliding window.
 *
 * AuthZ (ADR 0005): six built-in roles as immutable permission sets, plus
 * admin-defined custom roles (stored sets over the fixed catalog). The
 * effective permission set is resolved ONCE per request, in the same
 * identity query the hook already ran — no cross-request cache, so role
 * edits take effect on the next request on every HA node. Gates check
 * permissions via requirePermission; `admin` holds the full catalog (the
 * old requireRole admin bypass, preserved structurally). `viewer` holds
 * only requests.read: strictly read-only by construction.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type pg from "pg";
import { ApiError } from "../errors.js";
import { resolvePermissions, type Permission } from "../permissions.js";

export const SESSION_COOKIE = "ddas_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Role =
  | "admin"
  | "policy_author"
  | "approver"
  | "requester"
  | "auditor"
  | "viewer";

export const API_KEY_SCOPES = [
  "requests:read",
  "requests:write",
  "facts:attest",
  "mcp",
  /** IdP provisioning token — ONLY valid on /scim/v2, and exclusive at mint. */
  "scim",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface AuthedPrincipal {
  id: string;
  kind: "human" | "agent";
  name: string;
  email: string | null;
  roles: Role[];
  /** Resolved per request: built-in role sets ∪ custom-role stored grants. */
  permissions: ReadonlySet<Permission>;
}

export interface AuthedApiKey {
  id: string;
  scopes: ApiKeyScope[];
}

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthedPrincipal | null;
    /** Set when the request authenticated with an API key (not a session). */
    apiKey: AuthedApiKey | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      ...permissions: Permission[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireScope: (
      scope: ApiKeyScope
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** `ddas_<prefix>_<secret>` — prefix is the lookup key, sha256(token) the credential. */
export function newApiKey(): { token: string; prefix: string; tokenSha256: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("hex");
  const token = `ddas_${prefix}_${secret}`;
  return { token, prefix, tokenSha256: sha256hex(token) };
}

export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

export function newSessionToken(): { token: string; tokenSha256: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenSha256: sha256hex(token) };
}

/**
 * Correlated aggregate over the principal's custom-role grants — rides in
 * the same identity query the auth hook already runs (the ADR 0005 "caching
 * story": per-request join, no cross-node invalidation problem to have).
 */
const CUSTOM_PERMISSIONS_SQL = `
  (SELECT array_agg(DISTINCT crp.permission)
     FROM custom_role_assignments cra
     JOIN custom_role_permissions crp ON crp.role_id = cra.role_id
    WHERE cra.principal_id = p.id) AS custom_permissions`;

function buildPermissions(
  roles: readonly string[],
  storedGrants: readonly string[] | null,
  log: FastifyBaseLogger
): ReadonlySet<Permission> {
  return resolvePermissions(roles, storedGrants ?? [], (permission) =>
    log.warn({ permission }, "ignoring unknown stored permission (fail-closed)")
  );
}

export const authPlugin = fp(async (app, opts: { pool: pg.Pool }) => {
  const { pool } = opts;

  app.decorateRequest("principal", null);
  app.decorateRequest("apiKey", null);

  app.addHook("onRequest", async (request) => {
    // API key: Authorization: Bearer ddas_<prefix>_<secret>
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ddas_")) {
      const token = authorization.slice("Bearer ".length).trim();
      const parts = token.split("_");
      if (parts.length === 3 && parts[1]) {
        const result = await pool.query<{
          key_id: string;
          key_sha256: string;
          scopes: ApiKeyScope[];
          id: string;
          kind: "human" | "agent";
          name: string;
          email: string | null;
          roles: Role[] | null;
          custom_permissions: string[] | null;
        }>(
          `SELECT k.id AS key_id, k.key_sha256, k.scopes, p.id, p.kind, p.name, p.email,
                  array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL) AS roles,
                  ${CUSTOM_PERMISSIONS_SQL}
           FROM api_keys k
           JOIN principals p ON p.id = k.principal_id
           LEFT JOIN role_assignments r ON r.principal_id = p.id
           WHERE k.prefix = $1 AND k.revoked_at IS NULL AND p.disabled_at IS NULL
           GROUP BY k.id, p.id`,
          [parts[1]]
        );
        const row = result.rows[0];
        if (row && timingSafeEqualHex(row.key_sha256, sha256hex(token))) {
          request.principal = {
            id: row.id,
            kind: row.kind,
            name: row.name,
            email: row.email,
            roles: row.roles ?? [],
            permissions: buildPermissions(row.roles ?? [], row.custom_permissions, request.log),
          };
          request.apiKey = { id: row.key_id, scopes: row.scopes };
        }
      }
      return; // a presented bearer token never falls back to cookie auth
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenSha256 = sha256hex(token);
    const result = await pool.query<{
      id: string;
      session_id: string;
      kind: "human" | "agent";
      name: string;
      email: string | null;
      roles: Role[] | null;
      custom_permissions: string[] | null;
    }>(
      `SELECT p.id, s.id AS session_id, p.kind, p.name, p.email,
              array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL) AS roles,
              ${CUSTOM_PERMISSIONS_SQL}
       FROM sessions s
       JOIN principals p ON p.id = s.principal_id
       LEFT JOIN role_assignments r ON r.principal_id = p.id
       WHERE s.token_sha256 = $1 AND s.expires_at > now() AND p.disabled_at IS NULL
       GROUP BY p.id, s.id`,
      [tokenSha256]
    );
    const row = result.rows[0];
    if (!row) return;
    request.principal = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      email: row.email,
      roles: row.roles ?? [],
      permissions: buildPermissions(row.roles ?? [], row.custom_permissions, request.log),
    };
    // Sliding expiry (fire-and-forget; losing one slide is harmless).
    void pool
      .query(
        `UPDATE sessions SET last_seen_at = now(),
                expires_at = now() + interval '30 days'
         WHERE id = $1 AND last_seen_at < now() - interval '1 hour'`,
        [row.session_id]
      )
      .catch(() => undefined);
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    if (!request.principal) throw new ApiError("unauthorized", "authentication required");
  });

  app.decorate("requireScope", (scope: ApiKeyScope) => {
    return async (request: FastifyRequest) => {
      // Scopes bind API-key auth only; session (human) auth is governed by roles.
      if (request.apiKey && !request.apiKey.scopes.includes(scope)) {
        throw new ApiError("forbidden", `API key lacks the "${scope}" scope`);
      }
    };
  });

  // Any-of, like requireRole was. Deny-by-default: no permission, no route.
  // There is no admin special case — the built-in admin role simply holds
  // the full catalog (permissions.ts), which is the same bypass, made data.
  app.decorate("requirePermission", (...permissions: Permission[]) => {
    return async (request: FastifyRequest) => {
      if (!request.principal) throw new ApiError("unauthorized", "authentication required");
      const held = request.principal.permissions;
      if (!permissions.some((permission) => held.has(permission))) {
        throw new ApiError(
          "forbidden",
          `requires one of permissions: ${permissions.join(", ")}`
        );
      }
    };
  });
});

/**
 * In-memory login rate limit: N attempts per key per window.
 *
 * PER-NODE BY DESIGN (see docs/ha.md). This is the inner, fine-grained layer
 * (per email+IP) under the Postgres-backed auth-class limiter, which is the
 * shared cross-replica backstop. It stays in memory deliberately: its keys
 * embed attacker-controlled input (the attempted email), and mirroring them
 * into the shared store would let an unauthenticated client mint rows there.
 * With R replicas the effective per-email budget widens to at most R × limit,
 * still far below the shared per-IP cap that holds cluster-wide.
 */
export function makeLoginRateLimiter(limit = 10, windowMs = 60_000) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const MAX_ENTRIES = 10_000;
  return {
    check(key: string): boolean {
      const now = Date.now();
      // Bounded memory on long-lived nodes: shed expired entries once large.
      if (attempts.size >= MAX_ENTRIES) {
        for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
      }
      const entry = attempts.get(key);
      if (!entry || entry.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}
