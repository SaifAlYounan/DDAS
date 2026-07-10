/**
 * SCIM 2.0 e2e — the full IdP lifecycle over HTTP: token minting + scope
 * isolation, Users CRUD with filters, PATCH (Okta and Entra shapes),
 * deactivation that provably kills live sessions and API keys, Groups as
 * role grants with the last-admin guard, dedup against OIDC JIT in both
 * directions, agent invisibility, and the SCIM error envelope.
 */
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";
import { newSessionToken } from "./plugins/auth.js";
import { startFakeIdp, type FakeIdp } from "./testing/fake-idp.js";

const SCIM_ERROR_URN = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_URN = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const ADMIN_EMAIL = "admin@kolvarra.test";
const ADMIN_PASSWORD = "kolvarra-admin-pw";

describe.skipIf(!TEST_DATABASE_URL)("SCIM e2e", () => {
  let app: App;
  let pool: pg.Pool;
  let idp: FakeIdp;
  let adminCookie: string;
  let adminId: string;
  let scimToken: string;
  let rubenId: string; // the SCIM-provisioned user threaded through the suite

  async function asAdmin(opts: { method: string; url: string; payload?: unknown }) {
    return app.inject({
      method: opts.method as "GET",
      url: opts.url,
      headers: { cookie: adminCookie, "content-type": "application/json" },
      ...(opts.payload !== undefined ? { payload: JSON.stringify(opts.payload) } : {}),
    });
  }

  /** Drive a SCIM call the way an IdP does: bearer token + scim+json body. */
  async function scim(method: string, url: string, body?: unknown, token = scimToken) {
    return app.inject({
      method: method as "GET",
      url: `/scim/v2${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/scim+json" } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  }

  function patchBody(operations: unknown[]) {
    return { schemas: [PATCH_URN], Operations: operations };
  }

  async function principalCount(): Promise<number> {
    const result = await pool.query<{ count: string }>("SELECT count(*) FROM principals");
    return Number(result.rows[0]!.count);
  }

  /** Full browser dance against the fake IdP (same as the OIDC suite). */
  async function ssoLogin(): Promise<{ sessionCookie: string }> {
    const login = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/login" });
    expect(login.statusCode).toBe(302);
    const flowCookieHeader = login.headers["set-cookie"];
    const flowCookie = (Array.isArray(flowCookieHeader) ? flowCookieHeader[0] : flowCookieHeader)!
      .split(";")[0]!;
    const idpResponse = await fetch(login.headers.location!, { redirect: "manual" });
    expect(idpResponse.status).toBe(302);
    const callbackUrl = new URL(idpResponse.headers.get("location")!);
    const callback = await app.inject({
      method: "GET",
      url: callbackUrl.pathname + callbackUrl.search,
      headers: { cookie: flowCookie },
    });
    expect(callback.statusCode).toBe(302);
    const cookies = callback.headers["set-cookie"];
    const sessionCookie = (Array.isArray(cookies) ? cookies : [cookies!])
      .map((cookie) => cookie!.split(";")[0]!)
      .find((cookie) => cookie.startsWith("ddas_session="))!;
    expect(sessionCookie).toBeDefined();
    return { sessionCookie };
  }

  beforeAll(async () => {
    idp = await startFakeIdp("ddas-client");
    const fresh = await freshTestDb("scim");
    await fresh.close();
    pool = new pg.Pool({ connectionString: testDatabaseUrlFor("scim") });
    const env = loadEnv({
      DATABASE_URL: testDatabaseUrlFor("scim"),
      BLOB_DIR: "/tmp/ddas-scim-blobs",
      LOG_LEVEL: "error",
      DDAS_ADMIN_EMAIL: ADMIN_EMAIL,
      DDAS_ADMIN_PASSWORD: ADMIN_PASSWORD,
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: "ddas-client",
      OIDC_CLIENT_SECRET: "test-secret-test-secret",
      OIDC_REDIRECT_URL: "http://127.0.0.1:3999/api/v1/auth/oidc/callback",
      OIDC_DEFAULT_ROLES: "requester",
      OIDC_ALLOW_INSECURE: "true",
      RATE_LIMIT_AUTH_LIMIT: "100000",
      RATE_LIMIT_ADMIN_LIMIT: "100000",
      RATE_LIMIT_MUTATION_LIMIT: "100000",
      RATE_LIMIT_READ_LIMIT: "100000",
    });
    app = await buildApp({ pool, env, extractionProvider: null, withJobs: false });
    await app.ready();
    adminId = (await bootstrapAdmin(pool, env))!;

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;

    const minted = await asAdmin({
      method: "POST",
      url: "/api/v1/admin/api-keys",
      payload: { principalId: adminId, scopes: ["scim"] },
    });
    expect(minted.statusCode).toBe(200);
    scimToken = (minted.json() as { token: string }).token;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await idp?.close();
  });

  it("refuses to mint a scim key mixed with other scopes", async () => {
    const mixed = await asAdmin({
      method: "POST",
      url: "/api/v1/admin/api-keys",
      payload: { principalId: adminId, scopes: ["scim", "mcp"] },
    });
    expect(mixed.statusCode).toBe(422);
    expect((mixed.json() as { error: { code: string } }).error.code).toBe("validation_failed");
  });

  it("isolates the scim scope in BOTH directions", async () => {
    // A scim token is refused everywhere outside /scim/v2 …
    const outside = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${scimToken}` },
    });
    expect(outside.statusCode).toBe(403);

    // … a session cookie is refused on SCIM (401, SCIM envelope) …
    const withCookie = await app.inject({
      method: "GET",
      url: "/scim/v2/Users",
      headers: { cookie: adminCookie },
    });
    expect(withCookie.statusCode).toBe(401);
    expect(withCookie.headers["content-type"]).toContain("application/scim+json");
    expect((withCookie.json() as { schemas: string[] }).schemas).toEqual([SCIM_ERROR_URN]);

    // … and a normal API key (even an admin's) lacks the scim scope (403).
    const normalKey = await asAdmin({
      method: "POST",
      url: "/api/v1/admin/api-keys",
      payload: { principalId: adminId, scopes: ["mcp"] },
    });
    const denied = await scim("GET", "/Users", undefined, (normalKey.json() as { token: string }).token);
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { schemas: string[] }).schemas).toEqual([SCIM_ERROR_URN]);
  });

  it("serves the discovery documents", async () => {
    const config = await scim("GET", "/ServiceProviderConfig");
    expect(config.statusCode).toBe(200);
    const spc = config.json() as { patch: { supported: boolean }; bulk: { supported: boolean } };
    expect(spc.patch.supported).toBe(true);
    expect(spc.bulk.supported).toBe(false);

    const types = await scim("GET", "/ResourceTypes");
    const typesBody = types.json() as { totalResults: number; Resources: Array<{ id: string }> };
    expect(typesBody.Resources.map((r) => r.id).sort()).toEqual(["Group", "User"]);

    const schemas = await scim("GET", "/Schemas");
    expect((schemas.json() as { totalResults: number }).totalResults).toBe(2);
  });

  it("provisions a user: POST /Users → 201 with the SCIM resource", async () => {
    const created = await scim("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "ruben.finance@kolvarra.test",
      displayName: "Ruben Salt",
      externalId: "okta-1",
      active: true,
      emails: [{ value: "ruben.finance@kolvarra.test", primary: true }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["content-type"]).toContain("application/scim+json");
    const body = created.json() as {
      schemas: string[];
      id: string;
      userName: string;
      externalId: string;
      active: boolean;
      meta: { resourceType: string; location: string };
    };
    expect(body.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:User"]);
    expect(body.userName).toBe("ruben.finance@kolvarra.test");
    expect(body.externalId).toBe("okta-1");
    expect(body.active).toBe(true);
    rubenId = body.id;
    expect(body.meta.location).toBe(`/scim/v2/Users/${rubenId}`);

    const audited = await pool.query(
      `SELECT 1 FROM audit_events WHERE type = 'principal.created' AND payload->>'via' = 'scim'`
    );
    expect(audited.rows.length).toBe(1);
  });

  it("finds users by filter: userName eq / sw, externalId eq", async () => {
    const byName = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "RUBEN.FINANCE@kolvarra.test"')}`);
    const nameBody = byName.json() as { totalResults: number; Resources: Array<{ id: string }>; startIndex: number };
    expect(nameBody.totalResults).toBe(1);
    expect(nameBody.Resources[0]!.id).toBe(rubenId);
    expect(nameBody.startIndex).toBe(1);

    const byExternal = await scim("GET", `/Users?filter=${encodeURIComponent('externalId eq "okta-1"')}`);
    expect((byExternal.json() as { totalResults: number }).totalResults).toBe(1);

    const byPrefix = await scim("GET", `/Users?filter=${encodeURIComponent('userName sw "ruben"')}`);
    expect((byPrefix.json() as { totalResults: number }).totalResults).toBe(1);

    const miss = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "nobody@kolvarra.test"')}`);
    expect((miss.json() as { totalResults: number; Resources: unknown[] }).totalResults).toBe(0);

    const bad = await scim("GET", `/Users?filter=${encodeURIComponent('userName co "ruben"')}`);
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { scimType: string }).scimType).toBe("invalidFilter");
  });

  it("paginates the list", async () => {
    await scim("POST", "/Users", { userName: "petra.ops@kolvarra.test", displayName: "Petra Ops" });
    const page = await scim("GET", "/Users?count=1&startIndex=2");
    const body = page.json() as { totalResults: number; itemsPerPage: number; startIndex: number; Resources: unknown[] };
    expect(body.totalResults).toBeGreaterThanOrEqual(3); // admin + ruben + petra
    expect(body.itemsPerPage).toBe(1);
    expect(body.startIndex).toBe(2);
  });

  it("GETs one user, and answers 404 in the SCIM error envelope", async () => {
    const found = await scim("GET", `/Users/${rubenId}`);
    expect(found.statusCode).toBe(200);
    expect((found.json() as { id: string }).id).toBe(rubenId);

    for (const missing of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const response = await scim("GET", `/Users/${missing}`);
      expect(response.statusCode).toBe(404);
      const body = response.json() as { schemas: string[]; status: string; detail: string };
      expect(body.schemas).toEqual([SCIM_ERROR_URN]);
      expect(body.status).toBe("404");
      expect(body.detail).toContain("not found");
    }
  });

  it("answers 409 uniqueness on a duplicate userName", async () => {
    const dup = await scim("POST", "/Users", { userName: "ruben.finance@kolvarra.test" });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { scimType: string }).scimType).toBe("uniqueness");
  });

  it("grants and revokes roles through Group membership", async () => {
    // Okta shape: add to two groups.
    for (const group of ["requester", "approver"]) {
      const add = await scim(
        "PATCH",
        `/Groups/${group}`,
        patchBody([{ op: "add", path: "members", value: [{ value: rubenId }] }])
      );
      expect(add.statusCode).toBe(200);
      const members = (add.json() as { members: Array<{ value: string }> }).members;
      expect(members.map((m) => m.value)).toContain(rubenId);
    }
    const withRoles = await scim("GET", `/Users/${rubenId}`);
    const groups = (withRoles.json() as { groups: Array<{ value: string }> }).groups;
    expect(groups.map((g) => g.value).sort()).toEqual(["approver", "requester"]);

    // Okta removal shape: members[value eq "<id>"].
    const remove = await scim(
      "PATCH",
      "/Groups/approver",
      patchBody([{ op: "remove", path: `members[value eq "${rubenId}"]` }])
    );
    expect(remove.statusCode).toBe(200);
    const after = await scim("GET", `/Users/${rubenId}`);
    expect((after.json() as { groups: Array<{ value: string }> }).groups.map((g) => g.value)).toEqual([
      "requester",
    ]);

    const granted = await pool.query(
      `SELECT 1 FROM audit_events WHERE type = 'role.granted' AND payload->>'via' = 'scim'`
    );
    expect(granted.rows.length).toBe(2);
  });

  it("deactivation kills live sessions AND API keys immediately", async () => {
    // Give Ruben a live session (as if he had logged in) …
    const { token, tokenSha256 } = newSessionToken();
    await pool.query(
      `INSERT INTO sessions (principal_id, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [rubenId, tokenSha256]
    );
    const cookie = `ddas_session=${token}`;
    const alive = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(alive.statusCode).toBe(200);

    // … and a live API key.
    const minted = await asAdmin({
      method: "POST",
      url: "/api/v1/admin/api-keys",
      payload: { principalId: rubenId, scopes: ["requests:read"] },
    });
    const rubenKey = (minted.json() as { token: string }).token;
    const keyAlive = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${rubenKey}` },
    });
    expect(keyAlive.statusCode).toBe(200);

    // Entra shape: replace active with the STRING "False".
    const deactivate = await scim(
      "PATCH",
      `/Users/${rubenId}`,
      patchBody([{ op: "Replace", path: "active", value: "False" }])
    );
    expect(deactivate.statusCode).toBe(200);
    expect((deactivate.json() as { active: boolean }).active).toBe(false);

    // The live session 401s, the key 401s, the session row is GONE.
    const dead = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(dead.statusCode).toBe(401);
    const deadKey = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${rubenKey}` },
    });
    expect(deadKey.statusCode).toBe(401);
    const sessions = await pool.query("SELECT 1 FROM sessions WHERE principal_id = $1", [rubenId]);
    expect(sessions.rows.length).toBe(0);
    const keys = await pool.query(
      "SELECT 1 FROM api_keys WHERE principal_id = $1 AND revoked_at IS NULL",
      [rubenId]
    );
    expect(keys.rows.length).toBe(0);

    const audited = await pool.query(
      `SELECT payload FROM audit_events WHERE type = 'principal.disabled' AND entity->>'id' = $1`,
      [rubenId]
    );
    expect(audited.rows.length).toBe(1);
    expect((audited.rows[0] as { payload: { sessionsKilled: number } }).payload.sessionsKilled).toBe(1);
  });

  it("reactivation re-enables the account but resurrects no credential", async () => {
    const reactivate = await scim(
      "PATCH",
      `/Users/${rubenId}`,
      patchBody([{ op: "replace", value: { active: true } }]) // pathless Entra/Okta variant
    );
    expect(reactivate.statusCode).toBe(200);
    expect((reactivate.json() as { active: boolean }).active).toBe(true);
    const sessions = await pool.query("SELECT 1 FROM sessions WHERE principal_id = $1", [rubenId]);
    expect(sessions.rows.length).toBe(0); // sessions stayed dead
  });

  it("DELETE /Users/:id soft-deletes (deactivates)", async () => {
    const del = await scim("DELETE", `/Users/${rubenId}`);
    expect(del.statusCode).toBe(204);
    const gone = await scim("GET", `/Users/${rubenId}`);
    expect(gone.statusCode).toBe(200); // still visible — deactivated, not erased
    expect((gone.json() as { active: boolean }).active).toBe(false);
    // Re-enable for the OIDC dedup test below.
    await scim("PATCH", `/Users/${rubenId}`, patchBody([{ op: "replace", path: "active", value: true }]));
  });

  it("dedup, direction 1: an OIDC login binds to the SCIM-provisioned principal", async () => {
    const before = await principalCount();
    idp.nextUser = { sub: "sso-ruben", email: "ruben.finance@kolvarra.test", name: "Ruben SSO" };
    const { sessionCookie } = await ssoLogin();
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { id: string }).id).toBe(rubenId); // SAME principal
    expect(await principalCount()).toBe(before); // no duplicate
  });

  it("dedup, direction 2: SCIM adopts a JIT-provisioned principal via userName match", async () => {
    idp.nextUser = { sub: "sso-petra", email: "petra.jit@kolvarra.test", name: "Petra JIT" };
    await ssoLogin(); // JIT-provisions the principal
    const before = await principalCount();

    const found = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent('userName eq "petra.jit@kolvarra.test"')}`
    );
    const body = found.json() as { totalResults: number; Resources: Array<{ id: string }> };
    expect(body.totalResults).toBe(1);
    const jitId = body.Resources[0]!.id;

    // The IdP links its identifier onto the matched user — adoption, no create.
    const adopt = await scim(
      "PATCH",
      `/Users/${jitId}`,
      patchBody([{ op: "add", path: "externalId", value: "entra-77" }])
    );
    expect(adopt.statusCode).toBe(200);
    expect((adopt.json() as { externalId: string }).externalId).toBe("entra-77");
    expect(await principalCount()).toBe(before); // adopted, not duplicated

    const linked = await pool.query<{ external_id: string }>(
      "SELECT external_id FROM principals WHERE id = $1",
      [jitId]
    );
    expect(linked.rows[0]!.external_id).toBe("entra-77");
  });

  it("agents are invisible to SCIM: hidden from lists, 404 on access, refused writes", async () => {
    const agent = await asAdmin({
      method: "POST",
      url: "/api/v1/admin/principals",
      payload: {
        kind: "agent",
        name: "Procurement Bot",
        email: "bot@kolvarra.test",
        ownerPrincipalId: adminId,
        roles: ["requester"],
      },
    });
    expect(agent.statusCode).toBe(200);
    const agentId = (agent.json() as { id: string }).id;

    const list = await scim("GET", "/Users?count=200");
    const ids = (list.json() as { Resources: Array<{ id: string }> }).Resources.map((r) => r.id);
    expect(ids).not.toContain(agentId);

    expect((await scim("GET", `/Users/${agentId}`)).statusCode).toBe(404);
    expect(
      (
        await scim(
          "PATCH",
          `/Users/${agentId}`,
          patchBody([{ op: "replace", path: "active", value: false }])
        )
      ).statusCode
    ).toBe(404);
    expect((await scim("DELETE", `/Users/${agentId}`)).statusCode).toBe(404);

    // Its email is still taken (409, without revealing the agent) …
    expect((await scim("POST", "/Users", { userName: "bot@kolvarra.test" })).statusCode).toBe(409);

    // … it cannot be pushed into a group …
    const groupAdd = await scim(
      "PATCH",
      "/Groups/approver",
      patchBody([{ op: "add", path: "members", value: [{ value: agentId }] }])
    );
    expect(groupAdd.statusCode).toBe(400);

    // … and it never shows up as a member even though it HOLDS the role.
    const requesterGroup = await scim("GET", "/Groups/requester");
    const members = (requesterGroup.json() as { members: Array<{ value: string }> }).members;
    expect(members.map((m) => m.value)).not.toContain(agentId);
  });

  it("the last-admin guard holds on every SCIM path (and the admin API)", async () => {
    // The bootstrap admin is the only admin. Deactivating it must fail …
    const deactivate = await scim(
      "PATCH",
      `/Users/${adminId}`,
      patchBody([{ op: "replace", path: "active", value: false }])
    );
    expect(deactivate.statusCode).toBe(409);
    expect((deactivate.json() as { detail: string }).detail).toContain("last enabled admin");

    expect((await scim("DELETE", `/Users/${adminId}`)).statusCode).toBe(409);

    // … as must pulling it out of the admins group …
    const removal = await scim(
      "PATCH",
      "/Groups/admin",
      patchBody([{ op: "remove", path: `members[value eq "${adminId}"]` }])
    );
    expect(removal.statusCode).toBe(409);

    // … and the same guard protects the normal admin API.
    const viaApi = await asAdmin({
      method: "POST",
      url: `/api/v1/admin/principals/${adminId}/roles`,
      payload: { roles: ["viewer"] },
    });
    expect(viaApi.statusCode).toBe(409);

    // With a second admin the guard releases exactly as far as it should.
    await scim(
      "PATCH",
      "/Groups/admin",
      patchBody([{ op: "add", path: "members", value: [{ value: rubenId }] }])
    );
    const demoteSecond = await scim(
      "PATCH",
      "/Groups/admin",
      patchBody([{ op: "remove", path: `members[value eq "${rubenId}"]` }])
    );
    expect(demoteSecond.statusCode).toBe(200); // another enabled admin remains
  });

  it("PUT /Users replaces attributes, keeping externalId when omitted", async () => {
    const put = await scim("PUT", `/Users/${rubenId}`, {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: rubenId,
      userName: "ruben.salt@kolvarra.test",
      name: { formatted: "Ruben Salt II" },
      active: true,
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as { userName: string; displayName: string; externalId: string };
    expect(body.userName).toBe("ruben.salt@kolvarra.test");
    expect(body.displayName).toBe("Ruben Salt II");
    expect(body.externalId).toBe("okta-1"); // omitted → preserved, never unlinked
  });

  it("PUT /Groups replaces membership wholesale (adds before removes)", async () => {
    const put = await scim("PUT", "/Groups/viewer", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: "DDAS Viewers",
      members: [{ value: rubenId }],
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { members: Array<{ value: string }> }).members.map((m) => m.value)).toEqual(
      [rubenId]
    );

    const emptied = await scim("PUT", "/Groups/viewer", { members: [] });
    expect((emptied.json() as { members?: unknown[] }).members ?? []).toEqual([]);
  });

  it("lists the six fixed groups; excludedAttributes=members is honored", async () => {
    const groups = await scim("GET", "/Groups?excludedAttributes=members");
    const body = groups.json() as { totalResults: number; Resources: Array<Record<string, unknown>> };
    expect(body.totalResults).toBe(6);
    expect(body.Resources.map((g) => g["id"]).sort()).toEqual([
      "admin",
      "approver",
      "auditor",
      "policy_author",
      "requester",
      "viewer",
    ]);
    expect(body.Resources.every((g) => !("members" in g))).toBe(true);

    const filtered = await scim(
      "GET",
      `/Groups?filter=${encodeURIComponent('displayName eq "DDAS Approvers"')}`
    );
    const filteredBody = filtered.json() as { totalResults: number; Resources: Array<{ id: string }> };
    expect(filteredBody.totalResults).toBe(1);
    expect(filteredBody.Resources[0]!.id).toBe("approver");
  });

  it("every SCIM mutation went through the audit chain", async () => {
    const types = await pool.query<{ type: string }>(
      `SELECT DISTINCT type FROM audit_events
       WHERE actor->>'kind' = 'api_key' ORDER BY type`
    );
    expect(types.rows.map((r) => r.type)).toEqual([
      "principal.created",
      "principal.disabled",
      "principal.enabled",
      "principal.updated",
      "role.granted",
      "role.revoked",
    ]);
  });
});
