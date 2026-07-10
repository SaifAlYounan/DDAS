import argon2 from "argon2";
import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { secureCookie } from "../cookies.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import {
  makeLoginRateLimiter,
  newSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sha256hex,
} from "../plugins/auth.js";

export const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * The single password policy for every path that SETS a password (admin
 * creation, self-service change). Min length 12 — one source of truth so
 * the rule cannot drift between routes. Zod validation failures on a body
 * field surface as 422 (validation_failed) via the global error mapper.
 */
export const passwordSchema = z.string().min(12);

const PrincipalOut = z.object({
  id: z.string(),
  kind: z.enum(["human", "agent"]),
  name: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
});

export function registerAuthRoutes(app: App, ctx: AppContext): void {
  // Per-email limiter (guesses at one account) AND a coarser per-IP limiter
  // (credential stuffing across many emails from one source). Both are
  // per-node on purpose — defense in depth under the Postgres-backed auth
  // class limiter that holds across replicas (rationale in plugins/auth.ts
  // and docs/ha.md).
  const perEmailLimiter = makeLoginRateLimiter(10, 60_000);
  const perIpLimiter = makeLoginRateLimiter(50, 60_000);
  // A fixed argon2id hash to verify against when no account matches, so the
  // response takes the same time whether or not the email exists (no
  // enumeration oracle). Computed once at boot.
  const decoyHashPromise = argon2.hash("ddas-login-decoy-password", ARGON2_OPTS);

  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        body: z.object({ email: z.string().email(), password: z.string().min(1) }),
        response: { 200: PrincipalOut },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      if (!perIpLimiter.check(request.ip) || !perEmailLimiter.check(`${request.ip}:${email.toLowerCase()}`)) {
        throw new ApiError("forbidden", "too many login attempts — try again later");
      }
      const row = await ctx.pool.query<{
        id: string;
        kind: "human" | "agent";
        name: string;
        email: string | null;
        password_hash: string | null;
      }>(
        `SELECT id, kind, name, email, password_hash FROM principals
         WHERE lower(email) = lower($1) AND disabled_at IS NULL AND kind = 'human'`,
        [email]
      );
      const principal = row.rows[0];
      // Always run a verify — the real hash if the account exists, a decoy
      // otherwise — so timing does not reveal whether the email is registered.
      const valid = await argon2.verify(
        principal?.password_hash ?? (await decoyHashPromise),
        password
      );
      if (!principal || principal.password_hash == null || !valid) {
        await withTx(ctx.pool, (client) =>
          appendAuditEvent(client, {
            actor: { kind: "system" },
            type: "session.login_failed",
            entity: { type: "principal", id: principal?.id ?? "unknown" },
            payload: { email },
          })
        );
        throw new ApiError("unauthorized", "invalid credentials");
      }

      const { token, tokenSha256 } = newSessionToken();
      const roles = await withTx(ctx.pool, async (client) => {
        await client.query(
          `INSERT INTO sessions (principal_id, token_sha256, expires_at)
           VALUES ($1, $2, $3)`,
          [principal.id, tokenSha256, new Date(Date.now() + SESSION_TTL_MS)]
        );
        await appendAuditEvent(client, {
          actor: { kind: "principal", id: principal.id },
          type: "session.login",
          entity: { type: "principal", id: principal.id },
          payload: {},
        });
        const r = await client.query<{ role: string }>(
          "SELECT role FROM role_assignments WHERE principal_id = $1 ORDER BY role",
          [principal.id]
        );
        return r.rows.map((x) => x.role);
      });

      reply.setCookie(SESSION_COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookie(request),
        maxAge: SESSION_TTL_MS / 1000,
      });
      return {
        id: principal.id,
        kind: principal.kind,
        name: principal.name,
        email: principal.email,
        roles,
      };
    }
  );

  app.post(
    "/auth/logout",
    { schema: { tags: ["auth"], response: { 200: z.object({ ok: z.boolean() }) } } },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) {
        await withTx(ctx.pool, async (client) => {
          await client.query("DELETE FROM sessions WHERE token_sha256 = $1", [
            sha256hex(token),
          ]);
          if (request.principal) {
            await appendAuditEvent(client, {
              actor: { kind: "principal", id: request.principal.id },
              type: "session.logout",
              entity: { type: "principal", id: request.principal.id },
              payload: {},
            });
          }
        });
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    }
  );

  // Self-service password change for a human principal with a local password.
  //
  // Rejected for accounts with no local password credential (agents, which
  // authenticate by API key, and SCIM/OIDC-provisioned humans whose
  // password_hash is null) — those are managed by the identity provider, so
  // there is nothing to change here and we do NOT let them mint an initial
  // password on this path (409, clear message).
  //
  // On success we revoke every OTHER session of the principal (a leaked
  // session should not survive a password change) but KEEP the acting
  // session — the caller stays logged in on the device they just used.
  // API keys are a SEPARATE credential class (own lifecycle via /admin) and
  // are deliberately left intact: a password change is not a key rotation.
  app.post(
    "/auth/password",
    {
      schema: {
        tags: ["auth"],
        body: z.object({
          currentPassword: z.string().min(1),
          newPassword: passwordSchema,
        }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const principal = request.principal!;

      const row = await ctx.pool.query<{ password_hash: string | null }>(
        "SELECT password_hash FROM principals WHERE id = $1",
        [principal.id]
      );
      const passwordHash = row.rows[0]?.password_hash ?? null;
      if (principal.kind !== "human" || passwordHash === null) {
        throw new ApiError(
          "conflict",
          "this account has no password credential; it is managed via your identity provider"
        );
      }

      // Constant-time verify (same argon2 path as login).
      const valid = await argon2.verify(passwordHash, request.body.currentPassword);
      if (!valid) throw new ApiError("unauthorized", "current password is incorrect");

      const newHash = await argon2.hash(request.body.newPassword, ARGON2_OPTS);

      // The session making this request (if any) — a cookie caller keeps it;
      // an API-key caller has no session, so all sessions are revoked.
      const currentToken = request.cookies[SESSION_COOKIE];
      const keepSha = currentToken ? sha256hex(currentToken) : "";

      await withTx(ctx.pool, async (client) => {
        await client.query(
          "UPDATE principals SET password_hash = $1 WHERE id = $2",
          [newHash, principal.id]
        );
        // Revoke every OTHER session; empty keepSha matches no real token,
        // so an API-key caller (no session) revokes all of them.
        await client.query(
          "DELETE FROM sessions WHERE principal_id = $1 AND token_sha256 <> $2",
          [principal.id, keepSha]
        );
        await appendAuditEvent(client, {
          actor: { kind: "principal", id: principal.id },
          type: "principal.password_changed",
          entity: { type: "principal", id: principal.id },
          payload: {}, // never log the password
        });
      });

      return { ok: true };
    }
  );

  app.get(
    "/auth/me",
    {
      schema: { tags: ["auth"], response: { 200: PrincipalOut } },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const p = request.principal!;
      return { id: p.id, kind: p.kind, name: p.name, email: p.email, roles: p.roles };
    }
  );
}
