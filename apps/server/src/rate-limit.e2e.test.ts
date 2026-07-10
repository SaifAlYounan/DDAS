/**
 * Rate limiting over HTTP: an app configured with tight per-class limits
 * returns 429 + Retry-After once a class's window fills, classes do not
 * bleed into each other, /healthz and /metrics are never limited, and the
 * window rolls over. Login's own protections (401 on bad credentials)
 * stay intact underneath the auth-class limiter.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";
import { windowStartMs } from "./plugins/rate-limit.js";

const WINDOW_SEC = 2;
const WINDOW_MS = WINDOW_SEC * 1000;
const LIMITS = { auth: 3, read: 4, mutation: 3, admin: 3 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start each scenario just after a window boundary so counts are deterministic. */
async function freshWindow() {
  const next = windowStartMs(Date.now(), WINDOW_MS) + WINDOW_MS;
  await sleep(next - Date.now() + 50);
}

describe.skipIf(!TEST_DATABASE_URL)("rate limiting e2e", () => {
  let app: App;
  let pool: pg.Pool;
  let adminCookie = "";

  beforeAll(async () => {
    const fresh = await freshTestDb("ratelimit_e2e");
    await fresh.close();
    pool = new pg.Pool({ connectionString: testDatabaseUrlFor("ratelimit_e2e") });
    const env = loadEnv({
      DATABASE_URL: testDatabaseUrlFor("ratelimit_e2e"),
      BLOB_DIR: mkdtempSync(path.join(tmpdir(), "ddas-rl-blobs-")),
      DDAS_ADMIN_EMAIL: "admin@ratelimit.test",
      DDAS_ADMIN_PASSWORD: "admin-password-123",
      LOG_LEVEL: "error",
      RATE_LIMIT_AUTH_LIMIT: String(LIMITS.auth),
      RATE_LIMIT_AUTH_WINDOW_SEC: String(WINDOW_SEC),
      RATE_LIMIT_READ_LIMIT: String(LIMITS.read),
      RATE_LIMIT_READ_WINDOW_SEC: String(WINDOW_SEC),
      RATE_LIMIT_MUTATION_LIMIT: String(LIMITS.mutation),
      RATE_LIMIT_MUTATION_WINDOW_SEC: String(WINDOW_SEC),
      RATE_LIMIT_ADMIN_LIMIT: String(LIMITS.admin),
      RATE_LIMIT_ADMIN_WINDOW_SEC: String(WINDOW_SEC),
    });
    app = await buildApp({ pool, env, extractionProvider: null, withJobs: false });
    await bootstrapAdmin(pool, env);
    await app.ready();

    await freshWindow();
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@ratelimit.test", password: "admin-password-123" },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const get = (url: string) =>
    app.inject({ method: "GET", url, headers: { cookie: adminCookie } });

  it("429s the read class past its limit, with Retry-After, then recovers", async () => {
    await freshWindow();
    for (let i = 0; i < LIMITS.read; i++) {
      const ok = await get("/api/v1/policies");
      expect(ok.statusCode, `read ${i + 1}`).toBe(200);
    }
    const blocked = await get("/api/v1/policies");
    expect(blocked.statusCode).toBe(429);
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_SEC);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("rate_limited");

    // The window rolls over and the class recovers.
    await sleep(retryAfter * 1000 + 100);
    const recovered = await get("/api/v1/policies");
    expect(recovered.statusCode).toBe(200);
  }, 20_000);

  it("never limits /healthz or /metrics, even with the read class exhausted", async () => {
    await freshWindow();
    for (let i = 0; i < LIMITS.read + 1; i++) await get("/api/v1/policies"); // exhaust read
    expect((await get("/api/v1/policies")).statusCode).toBe(429);
    for (let i = 0; i < 20; i++) {
      expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(200);
    }
  }, 20_000);

  it("keeps the classes independent: exhausted mutations leave reads flowing", async () => {
    await freshWindow();
    for (let i = 0; i < LIMITS.mutation; i++) {
      // logout without a session is a harmless 200 mutation.
      const ok = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });
      expect(ok.statusCode, `mutation ${i + 1}`).toBe(200);
    }
    const blocked = await app.inject({ method: "POST", url: "/api/v1/auth/logout" });
    expect(blocked.statusCode).toBe(429);
    // Read and admin classes are untouched.
    expect((await get("/api/v1/policies")).statusCode).toBe(200);
    expect((await get("/api/v1/admin/settings")).statusCode).toBe(200);
  }, 20_000);

  it("gives the admin class its own budget", async () => {
    await freshWindow();
    for (let i = 0; i < LIMITS.admin; i++) {
      expect((await get("/api/v1/admin/settings")).statusCode, `admin ${i + 1}`).toBe(200);
    }
    const blocked = await get("/api/v1/admin/settings");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // An ordinary read still flows for the same principal.
    expect((await get("/api/v1/policies")).statusCode).toBe(200);
  }, 20_000);

  it("caps login attempts per IP while bad credentials still 401 underneath", async () => {
    await freshWindow();
    for (let i = 0; i < LIMITS.auth; i++) {
      const attempt = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin@ratelimit.test", password: "definitely-wrong-pw" },
      });
      // Under the limit: the normal invalid-credentials path (timing-oracle
      // protections included) answers — NOT the limiter.
      expect(attempt.statusCode, `attempt ${i + 1}`).toBe(401);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@ratelimit.test", password: "admin-password-123" },
    });
    // Past the limit even CORRECT credentials get 429 — the limiter answers
    // before any account lookup.
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("rate_limited");
  }, 20_000);
});
