/**
 * Per-route-class rate limiting over a Postgres fixed-window counter store.
 *
 * Four classes — auth (strictest), admin, mutation, read (generous) — each
 * with an env-configured limit/window. The store is a single atomic upsert
 * per request, so the limits hold across every app node sharing the database
 * (HA prep: no sticky sessions, no per-node state). /healthz and /metrics
 * are never rate-limited.
 *
 * The auth class keys by IP and is evaluated at onRequest, before the body
 * exists — it cannot leak whether an email is registered, so the login
 * timing-oracle protections (decoy argon2 verify + the in-memory per-email/
 * per-IP limiters in routes/auth.ts) stay intact underneath it.
 *
 * On a store error the request is ALLOWED (logged): the limiter is defense
 * in depth, and a database outage already fails the request downstream.
 */
import fp from "fastify-plugin";
import type pg from "pg";
import type { Env } from "../env.js";
import { ApiError, toEnvelope } from "../errors.js";

export type RouteClass = "auth" | "admin" | "read" | "mutation";

export interface ClassLimit {
  /** Max requests per window; 0 disables the class. */
  limit: number;
  windowMs: number;
}

export type RateLimitConfig = Record<RouteClass, ClassLimit>;

export function rateLimitConfigFromEnv(env: Env): RateLimitConfig {
  return {
    auth: { limit: env.RATE_LIMIT_AUTH_LIMIT, windowMs: env.RATE_LIMIT_AUTH_WINDOW_SEC * 1000 },
    admin: {
      limit: env.RATE_LIMIT_ADMIN_LIMIT,
      windowMs: env.RATE_LIMIT_ADMIN_WINDOW_SEC * 1000,
    },
    mutation: {
      limit: env.RATE_LIMIT_MUTATION_LIMIT,
      windowMs: env.RATE_LIMIT_MUTATION_WINDOW_SEC * 1000,
    },
    read: { limit: env.RATE_LIMIT_READ_LIMIT, windowMs: env.RATE_LIMIT_READ_WINDOW_SEC * 1000 },
  };
}

/** null = exempt (never rate-limited). */
export function classifyRoute(method: string, url: string): RouteClass | null {
  const pathname = url.split("?")[0]!;
  if (pathname === "/healthz" || pathname === "/metrics") return null;
  if (pathname === "/api/v1/auth/login" || pathname.startsWith("/api/v1/auth/oidc/")) {
    return "auth";
  }
  if (pathname.startsWith("/api/v1/admin/")) return "admin";
  // SCIM provisioning is IdP-driven identity administration — admin class,
  // keyed per principal (the scim token resolves to its minting admin).
  if (pathname.startsWith("/scim/v2")) return "admin";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "read";
  return "mutation";
}

// ---------- window math (pure — unit-tested) ----------

export function windowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/** Whole seconds until the current window rolls over (Retry-After), min 1. */
export function retryAfterSec(nowMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStartMs(nowMs, windowMs) + windowMs - nowMs) / 1000));
}

// ---------- the Postgres store ----------

const CLEANUP_EVERY = 256;

export class PgRateLimitStore {
  #pool: pg.Pool;
  #ops = 0;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Count one hit in the bucket's current fixed window and return the new
   * count — one atomic upsert, race-free across nodes. Expired rows are
   * swept opportunistically (fire-and-forget, every ~CLEANUP_EVERY calls).
   */
  async incr(bucket: string, nowMs: number, windowMs: number): Promise<number> {
    const windowStart = new Date(windowStartMs(nowMs, windowMs));
    const expiresAt = new Date(windowStartMs(nowMs, windowMs) + windowMs);
    const result = await this.#pool.query<{ count: number }>(
      `INSERT INTO rate_limit_counters (bucket, window_start, count, expires_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (bucket, window_start)
       DO UPDATE SET count = rate_limit_counters.count + 1
       RETURNING count`,
      [bucket, windowStart, expiresAt]
    );
    this.#ops += 1;
    if (this.#ops % CLEANUP_EVERY === 0) {
      void this.cleanup().catch(() => undefined);
    }
    return result.rows[0]!.count;
  }

  /** Delete counters whose window has fully passed. Returns rows removed. */
  async cleanup(now: Date = new Date()): Promise<number> {
    const result = await this.#pool.query(
      "DELETE FROM rate_limit_counters WHERE expires_at < $1",
      [now]
    );
    return result.rowCount ?? 0;
  }
}

// ---------- the plugin ----------

export const rateLimitPlugin = fp(
  async (app, opts: { pool: pg.Pool; config: RateLimitConfig }) => {
    const store = new PgRateLimitStore(opts.pool);

    // Registered AFTER the auth plugin, so request.principal is already
    // resolved and authenticated traffic is keyed per principal (an IP
    // shared by many users never starves them collectively).
    app.addHook("onRequest", async (request, reply) => {
      const routeClass = classifyRoute(request.method, request.url);
      if (!routeClass) return;
      const { limit, windowMs } = opts.config[routeClass];
      if (limit <= 0) return;

      // auth routes are pre-session by nature — always key by IP.
      const key =
        routeClass !== "auth" && request.principal
          ? `p:${request.principal.id}`
          : `ip:${request.ip}`;

      let count: number;
      try {
        count = await store.incr(`${routeClass}:${key}`, Date.now(), windowMs);
      } catch (err) {
        request.log.warn({ err }, "rate-limit store unavailable — allowing request");
        return;
      }
      if (count > limit) {
        const seconds = retryAfterSec(Date.now(), windowMs);
        const error = new ApiError(
          "rate_limited",
          `too many ${routeClass} requests — retry in ${seconds}s`
        );
        return reply
          .status(error.statusCode)
          .header("retry-after", String(seconds))
          .send(toEnvelope(error));
      }
    });
  }
);
