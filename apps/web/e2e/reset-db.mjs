/** Drop + recreate the smoke database, then the server (run next) migrates itself. */
import pg from "pg";

async function reset() {
  const url = new URL(
    process.env["SMOKE_DATABASE_URL"] ?? "postgres://postgres@localhost:5432/ddas_smoke"
  );
  const dbName = url.pathname.slice(1);
  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
}

await reset();
