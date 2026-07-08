/**
 * Test-database helper. Tests run against a real Postgres named by
 * TEST_DATABASE_URL (CI: a service container; locally: any Postgres 16).
 * When the variable is unset, db-backed suites skip with a notice —
 * plain `pnpm test` must never require a daemon.
 */
import pg from "pg";
import { createDb, migrate, type Db } from "./index.js";

export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

export interface TestDb {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Drop everything and re-migrate — each suite starts from a pristine schema. */
export async function freshTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) {
    throw new Error("freshTestDb called without TEST_DATABASE_URL");
  }
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  // The drizzle migrator keeps its journal in the "drizzle" schema — drop it
  // too, or a re-created public schema is left empty (journal says "applied").
  await pool.query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"
  );
  const db = createDb(pool);
  await migrate(db);
  return { db, pool, close: () => pool.end() };
}

/**
 * Assert a db promise rejects and that the FULL error chain (drizzle wraps
 * the Postgres error; the constraint name lives on `cause`) matches `pattern`.
 */
export async function expectDbReject(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const chain: string[] = [];
    let cursor: unknown = err;
    while (cursor instanceof Error) {
      chain.push(cursor.message);
      cursor = cursor.cause;
    }
    const text = chain.join(" | ");
    if (!pattern.test(text)) {
      throw new Error(`rejected, but "${text}" does not match ${pattern}`);
    }
    return;
  }
  throw new Error(`expected rejection matching ${pattern}, but the query succeeded`);
}
