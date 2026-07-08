/**
 * Regenerate the committed OpenAPI document (apps/server/openapi.json).
 * CI fails when routes drift from the committed spec — the web client is
 * generated from the FILE, never from a live server.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const app = await buildApp({ pool, env, extractionProvider: null, withJobs: false });
await app.ready();

const target = fileURLToPath(new URL("../../openapi.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(app.swagger(), null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(`wrote ${target}`);

await app.close();
await pool.end();
