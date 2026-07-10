/**
 * OIDC against an in-process fake IdP: discovery, authorization redirect,
 * PKCE-verified token exchange with a jose-signed RS256 id_token, and the
 * three JIT paths — (issuer,sub) match, email link, fresh provision.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import * as jose from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { loadEnv } from "./env.js";

interface FakeIdp {
  issuer: string;
  close: () => Promise<void>;
  /** claims returned in the next id_token */
  nextUser: { sub: string; email: string; name: string };
}

async function startFakeIdp(clientId: string): Promise<FakeIdp> {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const pendingCodes = new Map<string, { challenge: string }>();
  const state: FakeIdp = {
    issuer: "",
    close: async () => undefined,
    nextUser: { sub: "sso-user-1", email: "sso.user@kolvarra.test", name: "SSO User" },
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url!, state.issuer);
    const send = (status: number, body: unknown) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/authorize`,
        token_endpoint: `${state.issuer}/token`,
        jwks_uri: `${state.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") {
      return send(200, { keys: [jwk] });
    }
    if (url.pathname === "/authorize") {
      // "The user authenticates" — immediately bounce back with a code.
      const code = `code-${Math.random().toString(36).slice(2)}`;
      pendingCodes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "" });
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.statusCode = 302;
      response.setHeader("location", redirect.href);
      return response.end();
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        void (async () => {
          const params = new URLSearchParams(body);
          const code = params.get("code") ?? "";
          const verifier = params.get("code_verifier") ?? "";
          const pending = pendingCodes.get(code);
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!pending || pending.challenge !== challenge) {
            return send(400, { error: "invalid_grant" });
          }
          pendingCodes.delete(code);
          const idToken = await new jose.SignJWT({
            email: state.nextUser.email,
            name: state.nextUser.name,
          })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setIssuer(state.issuer)
            .setSubject(state.nextUser.sub)
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
          send(200, {
            access_token: "fake-access-token",
            token_type: "Bearer",
            expires_in: 300,
            id_token: idToken,
          });
        })();
      });
      return;
    }
    send(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  state.issuer = `http://127.0.0.1:${port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

describe.skipIf(!TEST_DATABASE_URL)("OIDC e2e", () => {
  let app: App;
  let pool: pg.Pool;
  let idp: FakeIdp;

  beforeAll(async () => {
    idp = await startFakeIdp("ddas-client");
    const fresh = await freshTestDb("oidc");
    await fresh.close();
    pool = new pg.Pool({ connectionString: testDatabaseUrlFor("oidc") });
    const env = loadEnv({
      DATABASE_URL: testDatabaseUrlFor("oidc"),
      BLOB_DIR: "/tmp/ddas-oidc-blobs",
      LOG_LEVEL: "error",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: "ddas-client",
      OIDC_CLIENT_SECRET: "test-secret-test-secret",
      OIDC_REDIRECT_URL: "http://127.0.0.1:3999/api/v1/auth/oidc/callback",
      OIDC_DEFAULT_ROLES: "requester,approver",
      OIDC_ALLOW_INSECURE: "true",
      // Every request here is auth-class from one IP; don't trip the limiter.
      RATE_LIMIT_AUTH_LIMIT: "100000",
    });
    app = await buildApp({ pool, env, extractionProvider: null, withJobs: false });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await idp?.close();
  });

  /** Drive the whole browser dance: login redirect → IdP → callback. */
  async function ssoLogin(): Promise<{ sessionCookie: string }> {
    const login = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/login" });
    expect(login.statusCode).toBe(302);
    const flowCookieHeader = login.headers["set-cookie"];
    const flowCookie = (Array.isArray(flowCookieHeader) ? flowCookieHeader[0] : flowCookieHeader)!
      .split(";")[0]!;
    const authorizeUrl = login.headers.location!;
    expect(authorizeUrl).toContain(`${idp.issuer}/authorize`);
    expect(authorizeUrl).toContain("code_challenge_method=S256");

    const idpResponse = await fetch(authorizeUrl, { redirect: "manual" });
    expect(idpResponse.status).toBe(302);
    const callbackUrl = new URL(idpResponse.headers.get("location")!);

    const callback = await app.inject({
      method: "GET",
      url: callbackUrl.pathname + callbackUrl.search,
      headers: { cookie: flowCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    const cookies = callback.headers["set-cookie"];
    const sessionCookie = (Array.isArray(cookies) ? cookies : [cookies!])
      .map((cookie) => cookie!.split(";")[0]!)
      .find((cookie) => cookie.startsWith("ddas_session="))!;
    expect(sessionCookie).toBeDefined();
    return { sessionCookie };
  }

  it("advertises OIDC via /auth/config", async () => {
    const config = await app.inject({ method: "GET", url: "/api/v1/auth/config" });
    expect(config.json()).toEqual({ oidcEnabled: true });
  });

  it("JIT-provisions on first SSO login with the default roles", async () => {
    const { sessionCookie } = await ssoLogin();
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { name: string; email: string; roles: string[] };
    expect(body.email).toBe("sso.user@kolvarra.test");
    expect(body.roles.sort()).toEqual(["approver", "requester"]);
  });

  it("reuses the same principal on the second login (issuer+sub match)", async () => {
    const before = await pool.query("SELECT count(*) FROM principals");
    const { sessionCookie } = await ssoLogin();
    const after = await pool.query("SELECT count(*) FROM principals");
    expect(after.rows[0].count).toBe(before.rows[0].count);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionCookie },
    });
    expect((me.json() as { email: string }).email).toBe("sso.user@kolvarra.test");
  });

  it("links an existing password account by email instead of duplicating it", async () => {
    const existing = await pool.query<{ id: string }>(
      `INSERT INTO principals (kind, name, email, password_hash)
       VALUES ('human', 'Petra Local', 'petra.local@kolvarra.test', 'x') RETURNING id`
    );
    idp.nextUser = { sub: "sso-user-2", email: "petra.local@kolvarra.test", name: "Petra SSO" };

    const { sessionCookie } = await ssoLogin();
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionCookie },
    });
    expect((me.json() as { id: string }).id).toBe(existing.rows[0]!.id);

    const linked = await pool.query<{ oidc_subject: string }>(
      "SELECT oidc_subject FROM principals WHERE id = $1",
      [existing.rows[0]!.id]
    );
    expect(linked.rows[0]!.oidc_subject).toBe("sso-user-2");
  });

  it("rejects a callback with a tampered state", async () => {
    const login = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/login" });
    const flowCookieHeader = login.headers["set-cookie"];
    const flowCookie = (Array.isArray(flowCookieHeader) ? flowCookieHeader[0] : flowCookieHeader)!
      .split(";")[0]!;
    const idpResponse = await fetch(login.headers.location!, { redirect: "manual" });
    const callbackUrl = new URL(idpResponse.headers.get("location")!);
    callbackUrl.searchParams.set("state", "forged-state");
    const callback = await app.inject({
      method: "GET",
      url: callbackUrl.pathname + callbackUrl.search,
      headers: { cookie: flowCookie },
    });
    expect(callback.statusCode).toBe(401);
  });
});
