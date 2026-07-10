/**
 * OIDC/SSO: authorization-code + PKCE via openid-client v6, with JIT
 * provisioning — (issuer, sub) match first, then email link, then create
 * with the env-configured default roles. Role elevation stays in-app or
 * comes via SCIM group membership (routes/scim.ts); the email link is also
 * what binds an OIDC login to a SCIM-provisioned principal (no duplicates).
 * Group-claim mapping is deliberately out of scope.
 */
import * as oidc from "openid-client";
import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import { newSessionToken, SESSION_COOKIE, SESSION_TTL_MS, type Role } from "../plugins/auth.js";

const FLOW_COOKIE = "ddas_oidc_flow";
const VALID_ROLES = new Set([
  "admin",
  "policy_author",
  "approver",
  "requester",
  "auditor",
  "viewer",
]);

function oidcEnabled(ctx: AppContext): boolean {
  return Boolean(
    ctx.env.OIDC_ISSUER_URL &&
      ctx.env.OIDC_CLIENT_ID &&
      ctx.env.OIDC_CLIENT_SECRET &&
      ctx.env.OIDC_REDIRECT_URL
  );
}

function defaultRoles(ctx: AppContext): Role[] {
  return ctx.env.OIDC_DEFAULT_ROLES.split(",")
    .map((role) => role.trim())
    .filter((role): role is Role => VALID_ROLES.has(role));
}

export function registerOidcRoutes(app: App, ctx: AppContext): void {
  let configPromise: Promise<oidc.Configuration> | null = null;
  const discover = (): Promise<oidc.Configuration> => {
    configPromise ??= oidc.discovery(
      new URL(ctx.env.OIDC_ISSUER_URL!),
      ctx.env.OIDC_CLIENT_ID!,
      ctx.env.OIDC_CLIENT_SECRET!,
      undefined,
      ctx.env.OIDC_ALLOW_INSECURE ? { execute: [oidc.allowInsecureRequests] } : {}
    );
    return configPromise;
  };

  app.get(
    "/auth/config",
    {
      schema: {
        tags: ["auth"],
        response: { 200: z.object({ oidcEnabled: z.boolean() }) },
      },
    },
    async () => ({ oidcEnabled: oidcEnabled(ctx) })
  );

  app.get("/auth/oidc/login", async (request, reply) => {
    if (!oidcEnabled(ctx)) throw new ApiError("not_found", "OIDC is not configured");
    const config = await discover();

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: ctx.env.OIDC_REDIRECT_URL!,
      scope: "openid email profile",
      state,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    });

    reply.setCookie(FLOW_COOKIE, JSON.stringify({ codeVerifier, state }), {
      path: "/api/v1/auth/oidc",
      httpOnly: true,
      sameSite: "lax",
      secure: request.protocol === "https",
      maxAge: 600,
    });
    return reply.redirect(authorizationUrl.href);
  });

  app.get("/auth/oidc/callback", async (request, reply) => {
    if (!oidcEnabled(ctx)) throw new ApiError("not_found", "OIDC is not configured");
    const flowCookie = request.cookies[FLOW_COOKIE];
    if (!flowCookie) throw new ApiError("unauthorized", "missing OIDC flow state — restart login");
    const { codeVerifier, state } = JSON.parse(flowCookie) as {
      codeVerifier: string;
      state: string;
    };

    const config = await discover();
    // Reconstruct the callback URL the IdP redirected to (code + state live in the query).
    const currentUrl = new URL(ctx.env.OIDC_REDIRECT_URL!);
    const queryIndex = request.url.indexOf("?");
    currentUrl.search = queryIndex >= 0 ? request.url.slice(queryIndex) : "";

    let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
    try {
      tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });
    } catch (err) {
      throw new ApiError("unauthorized", `OIDC token exchange failed: ${String(err)}`);
    }
    const claims = tokens.claims();
    if (!claims?.sub) throw new ApiError("unauthorized", "id_token carried no subject");
    const issuer = String(claims.iss);
    const subject = String(claims.sub);
    const email = typeof claims["email"] === "string" ? claims["email"] : null;
    const name =
      typeof claims["name"] === "string" ? claims["name"] : (email ?? `sso:${subject}`);

    const principalId = await withTx(ctx.pool, async (client) => {
      // 1. Known (issuer, sub).
      const linked = await client.query<{ id: string; disabled_at: Date | null }>(
        "SELECT id, disabled_at FROM principals WHERE oidc_issuer = $1 AND oidc_subject = $2",
        [issuer, subject]
      );
      if (linked.rows[0]) {
        if (linked.rows[0].disabled_at) throw new ApiError("forbidden", "account is disabled");
        return linked.rows[0].id;
      }
      // 2. Existing human by email → link.
      if (email) {
        const byEmail = await client.query<{ id: string; disabled_at: Date | null }>(
          "SELECT id, disabled_at FROM principals WHERE lower(email) = lower($1) AND kind = 'human'",
          [email]
        );
        if (byEmail.rows[0]) {
          if (byEmail.rows[0].disabled_at) throw new ApiError("forbidden", "account is disabled");
          await client.query(
            "UPDATE principals SET oidc_issuer = $2, oidc_subject = $3 WHERE id = $1",
            [byEmail.rows[0].id, issuer, subject]
          );
          await appendAuditEvent(client, {
            actor: { kind: "system" },
            type: "principal.updated",
            entity: { type: "principal", id: byEmail.rows[0].id },
            payload: { linkedOidc: { issuer, subject } },
          });
          return byEmail.rows[0].id;
        }
      }
      // 3. JIT provision with the default roles.
      const created = await client.query<{ id: string }>(
        `INSERT INTO principals (kind, name, email, oidc_issuer, oidc_subject)
         VALUES ('human', $1, $2, $3, $4) RETURNING id`,
        [name, email, issuer, subject]
      );
      const id = created.rows[0]!.id;
      for (const role of defaultRoles(ctx)) {
        await client.query(
          "INSERT INTO role_assignments (principal_id, role) VALUES ($1, $2)",
          [id, role]
        );
      }
      await appendAuditEvent(client, {
        actor: { kind: "system" },
        type: "principal.created",
        entity: { type: "principal", id },
        payload: { via: "oidc_jit", issuer, roles: defaultRoles(ctx) },
      });
      return id;
    });

    const { token, tokenSha256 } = newSessionToken();
    await withTx(ctx.pool, async (client) => {
      await client.query(
        "INSERT INTO sessions (principal_id, token_sha256, expires_at) VALUES ($1, $2, $3)",
        [principalId, tokenSha256, new Date(Date.now() + SESSION_TTL_MS)]
      );
      await appendAuditEvent(client, {
        actor: { kind: "principal", id: principalId },
        type: "session.login",
        entity: { type: "principal", id: principalId },
        payload: { method: "oidc" },
      });
    });

    reply.clearCookie(FLOW_COOKIE, { path: "/api/v1/auth/oidc" });
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: request.protocol === "https",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return reply.redirect("/");
  });
}
