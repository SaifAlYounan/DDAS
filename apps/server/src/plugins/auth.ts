/**
 * Session auth: opaque 32-byte token in an HttpOnly SameSite=Lax cookie;
 * only its sha256 is stored. 30-day sliding window. Five fixed roles;
 * admin passes every role gate.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type pg from "pg";
import { ApiError } from "../errors.js";

export const SESSION_COOKIE = "ddas_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Role = "admin" | "policy_author" | "approver" | "requester" | "auditor";

export const API_KEY_SCOPES = [
  "requests:read",
  "requests:write",
  "facts:attest",
  "mcp",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface AuthedPrincipal {
  id: string;
  kind: "human" | "agent";
  name: string;
  email: string | null;
  roles: Role[];
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
    requireRole: (
      ...roles: Role[]
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
        }>(
          `SELECT k.id AS key_id, k.key_sha256, k.scopes, p.id, p.kind, p.name, p.email,
                  array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL) AS roles
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
    }>(
      `SELECT p.id, s.id AS session_id, p.kind, p.name, p.email,
              array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL) AS roles
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

  app.decorate("requireRole", (...roles: Role[]) => {
    return async (request: FastifyRequest) => {
      if (!request.principal) throw new ApiError("unauthorized", "authentication required");
      const held = request.principal.roles;
      if (held.includes("admin")) return;
      if (!roles.some((role) => held.includes(role))) {
        throw new ApiError("forbidden", `requires one of roles: ${roles.join(", ")}`);
      }
    };
  });
});

/** Naive in-memory login rate limit: N attempts per key per window. */
export function makeLoginRateLimiter(limit = 10, windowMs = 60_000) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string): boolean {
      const now = Date.now();
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
