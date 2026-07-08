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
 * Apply all pending migrations. The server refuses to boot on schema mismatch
 * by running this at startup; `ddas migrate` runs it explicitly.
 */
export async function migrate(db: Db, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder });
}
