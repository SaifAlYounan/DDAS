/**
 * Rate limiting: the pure window math and route classifier (always), and the
 * Postgres counter store against a real database (when TEST_DATABASE_URL is
 * set) — including the atomicity that makes it multi-node safe.
 */
import { freshTestDb, TEST_DATABASE_URL } from "@ddas/db/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyRoute,
  PgRateLimitStore,
  retryAfterSec,
  windowStartMs,
} from "./rate-limit.js";

describe("window math", () => {
  it("floors now to the window boundary", () => {
    expect(windowStartMs(0, 60_000)).toBe(0);
    expect(windowStartMs(59_999, 60_000)).toBe(0);
    expect(windowStartMs(60_000, 60_000)).toBe(60_000);
    expect(windowStartMs(123_456, 60_000)).toBe(120_000);
    expect(windowStartMs(1_699_999_999_999, 60_000)).toBe(1_699_999_980_000);
  });

  it("retry-after counts whole seconds to the rollover, never below 1", () => {
    expect(retryAfterSec(0, 60_000)).toBe(60);
    expect(retryAfterSec(30_000, 60_000)).toBe(30);
    expect(retryAfterSec(59_001, 60_000)).toBe(1);
    // Sub-second remainders round UP — a client that waits Retry-After
    // seconds always lands in the next window.
    expect(retryAfterSec(59_999, 60_000)).toBe(1);
    expect(retryAfterSec(58_500, 60_000)).toBe(2);
  });
});

describe("route classifier", () => {
  it("exempts the operational endpoints", () => {
    expect(classifyRoute("GET", "/healthz")).toBeNull();
    expect(classifyRoute("GET", "/metrics")).toBeNull();
  });

  it("puts credential endpoints in the auth class", () => {
    expect(classifyRoute("POST", "/api/v1/auth/login")).toBe("auth");
    expect(classifyRoute("GET", "/api/v1/auth/oidc/login")).toBe("auth");
    expect(classifyRoute("GET", "/api/v1/auth/oidc/callback?code=x&state=y")).toBe("auth");
    // …but not the session-check endpoints the SPA polls.
    expect(classifyRoute("GET", "/api/v1/auth/me")).toBe("read");
    expect(classifyRoute("GET", "/api/v1/auth/config")).toBe("read");
    expect(classifyRoute("POST", "/api/v1/auth/logout")).toBe("mutation");
  });

  it("puts everything under /admin/ in the admin class, any method", () => {
    expect(classifyRoute("GET", "/api/v1/admin/principals")).toBe("admin");
    expect(classifyRoute("POST", "/api/v1/admin/api-keys")).toBe("admin");
    expect(classifyRoute("PUT", "/api/v1/admin/settings")).toBe("admin");
    expect(classifyRoute("POST", "/api/v1/admin/webhook-deliveries/x/redeliver")).toBe("admin");
  });

  it("puts SCIM provisioning in the admin class, any method", () => {
    expect(classifyRoute("GET", '/scim/v2/Users?filter=userName eq "a@b.c"')).toBe("admin");
    expect(classifyRoute("POST", "/scim/v2/Users")).toBe("admin");
    expect(classifyRoute("PATCH", "/scim/v2/Groups/admin")).toBe("admin");
    expect(classifyRoute("GET", "/scim/v2/ServiceProviderConfig")).toBe("admin");
  });

  it("splits the rest into read vs mutation by method", () => {
    expect(classifyRoute("GET", "/api/v1/requests")).toBe("read");
    expect(classifyRoute("GET", "/api/v1/requests?state=decided")).toBe("read");
    expect(classifyRoute("HEAD", "/api/v1/policies")).toBe("read");
    expect(classifyRoute("GET", "/api/openapi.json")).toBe("read");
    expect(classifyRoute("POST", "/api/v1/requests")).toBe("mutation");
    expect(classifyRoute("PATCH", "/api/v1/fact-sets/x/facts/y")).toBe("mutation");
    expect(classifyRoute("DELETE", "/api/v1/org/delegations/x")).toBe("mutation");
    expect(classifyRoute("POST", "/mcp")).toBe("mutation");
  });
});

describe.skipIf(!TEST_DATABASE_URL)("Postgres counter store", () => {
  let pool: pg.Pool;
  let close: () => Promise<void>;
  let store: PgRateLimitStore;
  const WINDOW = 60_000;

  beforeAll(async () => {
    const fresh = await freshTestDb("ratelimit");
    pool = fresh.pool;
    close = fresh.close;
    store = new PgRateLimitStore(pool);
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  it("counts hits within one window and isolates buckets", async () => {
    const now = Date.now();
    expect(await store.incr("read:p:alice", now, WINDOW)).toBe(1);
    expect(await store.incr("read:p:alice", now + 10, WINDOW)).toBe(2);
    expect(await store.incr("read:p:alice", now + 20, WINDOW)).toBe(3);
    // A different bucket does not share the counter.
    expect(await store.incr("read:p:bob", now, WINDOW)).toBe(1);
    expect(await store.incr("mutation:p:alice", now, WINDOW)).toBe(1);
  });

  it("resets when the window rolls over", async () => {
    // Pin "now" to a window boundary so the next window is deterministic.
    const start = windowStartMs(Date.now(), WINDOW);
    expect(await store.incr("read:p:carol", start, WINDOW)).toBe(1);
    expect(await store.incr("read:p:carol", start + WINDOW - 1, WINDOW)).toBe(2);
    expect(await store.incr("read:p:carol", start + WINDOW, WINDOW)).toBe(1);
  });

  it("stays exact under concurrency (the multi-node property)", async () => {
    const now = Date.now();
    const hits = await Promise.all(
      Array.from({ length: 50 }, () => store.incr("auth:ip:1.2.3.4", now, WINDOW))
    );
    // Every increment observed a distinct count — no lost updates.
    expect(new Set(hits).size).toBe(50);
    expect(Math.max(...hits)).toBe(50);
  });

  it("cleanup removes only expired windows", async () => {
    const start = windowStartMs(Date.now(), WINDOW);
    await store.incr("read:p:old", start - 10 * WINDOW, WINDOW); // long expired
    await store.incr("read:p:current", start, WINDOW); // live
    const removed = await store.cleanup(new Date(start));
    expect(removed).toBeGreaterThanOrEqual(1);
    const rows = await pool.query<{ bucket: string }>(
      "SELECT bucket FROM rate_limit_counters WHERE bucket IN ('read:p:old','read:p:current')"
    );
    expect(rows.rows.map((r) => r.bucket)).toEqual(["read:p:current"]);
  });
});
