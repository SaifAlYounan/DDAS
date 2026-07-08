import type pg from "pg";

/**
 * Adapt a pg client to pg-boss's `db` option so `boss.send(..., { db: bossDb(client) })`
 * enqueues the job INSIDE the caller's transaction — the job row commits (or
 * rolls back) atomically with the business write, so a crash between commit and
 * a separate send can never strand a request with no job queued.
 */
export function bossDb(client: pg.ClientBase): {
  executeSql(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
} {
  return {
    executeSql: (text, values) =>
      client.query(text, values as unknown[]).then((r) => ({ rows: r.rows })),
  };
}

/** Postgres transient errors that are safe to retry from a clean transaction. */
const RETRYABLE_SQLSTATES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
]);

function isRetryable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    RETRYABLE_SQLSTATES.has((err as { code?: string }).code ?? "")
  );
}

/**
 * Run fn inside BEGIN/COMMIT on a dedicated client. Rolls back on throw.
 *
 * Retries the WHOLE transaction on a deadlock or serialization failure — the
 * audit chain's single advisory lock is acquired lazily (after row locks), so
 * two mutating transactions that touch the same request from different entry
 * points can deadlock; Postgres aborts one cleanly and we replay it. Callers
 * must therefore keep fn side-effect-free outside the transaction (it may run
 * more than once); enqueue jobs and bump counters AFTER withTx returns.
 */
export async function withTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      lastErr = err;
      if (attempt < maxAttempts && isRetryable(err)) {
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
  throw lastErr;
}
