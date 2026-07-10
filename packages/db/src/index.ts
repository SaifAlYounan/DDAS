import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import * as schema from "./schema.js";

export * from "./schema.js";
export { loadOrgSnapshot, type OrgSnapshot } from "./seed.js";

export type Db = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

// dist/index.js → ../migrations (shipped alongside dist in the package)
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

/**
 * Advisory-lock key serializing migrations (arbitrary constant, project-unique;
 * the audit chain and admin bootstrap use their own keys).
 */
const MIGRATION_LOCK_KEY = 7_474_101;

/**
 * Apply all pending migrations. The server refuses to boot on schema mismatch
 * by running this at startup; `ddas migrate` runs it explicitly.
 *
 * Safe under concurrent boots (replicas > 1): drizzle's migrator has no lock
 * of its own, so two nodes starting together would race the same DDL. We take
 * a session-level advisory lock on a dedicated connection and run the whole
 * migrator on that same connection — the second node blocks, then finds the
 * journal already advanced and applies nothing.
 */
export async function migrate(pool: pg.Pool, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await drizzleMigrate(drizzle(client, { schema }), { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
