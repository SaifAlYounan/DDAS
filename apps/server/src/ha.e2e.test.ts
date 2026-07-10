/**
 * HA / multi-replica proof: TWO fully-booted server instances ("node A" and
 * "node B", jobs and webhook workers included) over ONE Postgres, booted
 * CONCURRENTLY against a pristine UNMIGRATED database — exactly what two
 * replicas racing a cold start look like. Proves:
 *
 *   1. both nodes serve traffic after the concurrent cold boot
 *      (i.e. neither crashed racing migrations — @ddas/db's advisory lock);
 *   2. boot migrations applied exactly once (no duplicate journal rows);
 *   3. first-boot admin bootstrap ran exactly once (single admin row,
 *      single admin.bootstrap audit event) despite both nodes attempting it;
 *   4. a session minted on node A authenticates on node B (Postgres-backed);
 *   5. the auth rate limit is SHARED: N requests alternated across both
 *      nodes still 429 at the shared limit, and both nodes agree;
 *   6. a webhook delivery is sent exactly once even though BOTH nodes run
 *      the delivery worker (FOR UPDATE SKIP LOCKED claim).
 *
 * The known per-node residual (the in-memory per-email/per-IP login limiter,
 * kept deliberately as defense in depth) is documented in docs/ha.md.
 */
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv, type Env } from "./env.js";
import { windowStartMs } from "./plugins/rate-limit.js";

const SUITE = "ha_e2e";
const ADMIN_EMAIL = "admin@ha.test";
const ADMIN_PASSWORD = "admin-password-123";
const AUTH_LIMIT = 6;
const WINDOW_SEC = 4;
const WINDOW_MS = WINDOW_SEC * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start each scenario just after a window boundary so counts are deterministic. */
async function freshWindow() {
  const next = windowStartMs(Date.now(), WINDOW_MS) + WINDOW_MS;
  await sleep(next - Date.now() + 50);
}

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await sleep(100);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

interface Node {
  app: App;
  pool: pg.Pool;
}

/** Mirror main.ts's boot order exactly: buildApp (migrate inside) → bootstrapAdmin. */
async function bootNode(env: Env): Promise<Node> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const app = await buildApp({ pool, env, extractionProvider: null, withJobs: true });
  await bootstrapAdmin(pool, env);
  await app.ready();
  return { app, pool };
}

describe.skipIf(!TEST_DATABASE_URL)("HA: two replicas over one Postgres", () => {
  let a: Node;
  let b: Node;
  let checkPool: pg.Pool;
  let adminCookie = "";

  beforeAll(async () => {
    // Create the suite database, then strip it back to a pristine UNMIGRATED
    // state: the two nodes must race the boot migrations themselves.
    const fresh = await freshTestDb(SUITE);
    await fresh.pool.query(
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE;"
    );
    await fresh.close();

    const mkEnv = (tag: string): Env =>
      loadEnv({
        DATABASE_URL: testDatabaseUrlFor(SUITE),
        BLOB_DIR: mkdtempSync(path.join(tmpdir(), `ddas-ha-${tag}-`)),
        DDAS_ADMIN_EMAIL: ADMIN_EMAIL,
        DDAS_ADMIN_PASSWORD: ADMIN_PASSWORD,
        LOG_LEVEL: "error",
        WEBHOOK_POLL_MS: "50",
        RATE_LIMIT_AUTH_LIMIT: String(AUTH_LIMIT),
        RATE_LIMIT_AUTH_WINDOW_SEC: String(WINDOW_SEC),
        // Generous everywhere else so scenario traffic never trips them.
        RATE_LIMIT_READ_LIMIT: "100000",
        RATE_LIMIT_MUTATION_LIMIT: "100000",
        RATE_LIMIT_ADMIN_LIMIT: "100000",
      });

    // THE point of the suite: both replicas cold-boot at the same instant.
    [a, b] = await Promise.all([bootNode(mkEnv("a")), bootNode(mkEnv("b"))]);
    checkPool = new pg.Pool({ connectionString: testDatabaseUrlFor(SUITE), max: 2 });
  }, 120_000);

  afterAll(async () => {
    await a?.app.close();
    await b?.app.close();
    await a?.pool.end();
    await b?.pool.end();
    await checkPool?.end();
  });

  it("both nodes serve traffic after the concurrent cold boot", async () => {
    for (const [name, node] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const health = await node.app.inject({ method: "GET", url: "/healthz" });
      expect(health.statusCode, `node ${name} /healthz`).toBe(200);
      expect(health.json()).toEqual({ ok: true });
    }
  });

  it("boot migrations applied exactly once (advisory-locked, no duplicate journal rows)", async () => {
    const dupes = await checkPool.query(
      `SELECT hash, count(*)::int AS n FROM drizzle.__drizzle_migrations
       GROUP BY hash HAVING count(*) > 1`
    );
    expect(dupes.rows).toEqual([]);
    const total = await checkPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations"
    );
    expect(total.rows[0]!.n).toBeGreaterThan(0);
  });

  it("first-boot admin bootstrap ran exactly once across both nodes", async () => {
    const admins = await checkPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM principals WHERE email = $1",
      [ADMIN_EMAIL]
    );
    expect(admins.rows[0]!.n).toBe(1);
    const events = await checkPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE type = 'admin.bootstrap'"
    );
    expect(events.rows[0]!.n).toBe(1);
  });

  it("a session minted on node A authenticates on node B", async () => {
    await freshWindow();
    const login = await a.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;

    const me = await b.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: adminCookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { email: string }).email).toBe(ADMIN_EMAIL);
  }, 20_000);

  it("the auth rate limit is shared: attempts split across nodes 429 at the shared limit", async () => {
    await freshWindow();
    const attempt = (node: Node) =>
      node.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: ADMIN_EMAIL, password: "wrong-password-xyz" },
      });
    const nodes = [a, b];
    for (let i = 0; i < AUTH_LIMIT; i++) {
      // Alternate A/B: each node sees only half the traffic. A per-node
      // limiter would allow 2× the budget; the shared store must not.
      const res = await attempt(nodes[i % 2]!);
      expect(res.statusCode, `attempt ${i + 1}`).toBe(401);
    }
    const blockedB = await attempt(b);
    expect(blockedB.statusCode).toBe(429);
    expect((blockedB.json() as { error: { code: string } }).error.code).toBe("rate_limited");
    const blockedA = await attempt(a);
    expect(blockedA.statusCode, "both nodes read the same counter").toBe(429);
  }, 30_000);

  it("webhook fanout delivers exactly once though BOTH nodes run delivery workers", async () => {
    const hits: string[] = [];
    const receiver = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        hits.push(String(request.headers["x-ddas-delivery"]));
        response.statusCode = 200;
        response.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const port = (receiver.address() as { port: number }).port;

    try {
      const hook = await a.app.inject({
        method: "POST",
        url: "/api/v1/admin/webhooks",
        headers: { cookie: adminCookie },
        payload: { url: `http://127.0.0.1:${port}/hook`, events: ["org_unit.created"] },
      });
      expect(hook.statusCode).toBe(200);

      // Trigger on node A: audit INSERT → fanout trigger → one delivery row,
      // with both nodes' workers polling it every 50ms.
      const unit = await a.app.inject({
        method: "POST",
        url: "/api/v1/org/units",
        headers: { cookie: adminCookie },
        payload: { name: "HA Proof Unit" },
      });
      expect(unit.statusCode).toBe(200);

      await waitFor(() => hits.length >= 1, 15_000);
      // Both workers keep sweeping; give any double-send ample time to show.
      await sleep(1_500);
      expect(hits).toHaveLength(1);

      const rows = await checkPool.query<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM webhook_deliveries"
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ status: "delivered", attempts: 1 });
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  }, 30_000);
});
