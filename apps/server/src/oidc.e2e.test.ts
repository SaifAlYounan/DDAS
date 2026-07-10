/**
 * OIDC against an in-process fake IdP (src/testing/fake-idp.ts): discovery,
 * authorization redirect, PKCE-verified token exchange with a jose-signed
 * RS256 id_token, and the three JIT paths — (issuer,sub) match, email link,
 * fresh provision.
 */
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { loadEnv } from "./env.js";
import { startFakeIdp, type FakeIdp } from "./testing/fake-idp.js";

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
