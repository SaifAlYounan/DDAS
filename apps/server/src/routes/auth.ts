import argon2 from "argon2";
import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
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

const PrincipalOut = z.object({
  id: z.string(),
  kind: z.enum(["human", "agent"]),
  name: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
});

export function registerAuthRoutes(app: App, ctx: AppContext): void {
  const rateLimiter = makeLoginRateLimiter();

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
      const key = `${request.ip}:${email.toLowerCase()}`;
      if (!rateLimiter.check(key)) {
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
      const valid =
        principal?.password_hash != null &&
        (await argon2.verify(principal.password_hash, password));
      if (!principal || !valid) {
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
        secure: request.protocol === "https",
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
