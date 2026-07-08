import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendAuditEvent } from "@ddas/audit";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { cmdBackupCreate, cmdBackupRestore } from "./backup.js";
import type { Output } from "./commands.js";

function hasPgDump(): boolean {
  try {
    execSync("pg_dump --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const runnable = Boolean(TEST_DATABASE_URL) && hasPgDump();
if (!runnable) {
  // eslint-disable-next-line no-console
  console.warn("skipping backup suite (needs TEST_DATABASE_URL + pg_dump on PATH)");
}

const quiet: Output = { log: () => undefined, error: () => undefined };

async function emptyDatabase(suite: string): Promise<string> {
  const url = testDatabaseUrlFor(suite);
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  const name = new URL(url).pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  return url;
}

describe.skipIf(!runnable)("ddas backup", () => {
  let sourceUrl: string;
  let backupDir: string;
  const blobDir = mkdtempSync(path.join(tmpdir(), "ddas-backup-blobs-"));

  beforeAll(async () => {
    const t = await freshTestDb("clibackup");
    sourceUrl = testDatabaseUrlFor("clibackup");
    const client = await t.pool.connect();
    try {
      for (let i = 0; i < 3; i++) {
        await client.query("BEGIN");
        await appendAuditEvent(client, {
          actor: { kind: "system" },
          type: "settings.updated",
          entity: { type: "org_settings", id: "singleton" },
          payload: { i },
        });
        await client.query("COMMIT");
      }
    } finally {
      client.release();
    }
    await t.close();
    writeFileSync(path.join(blobDir, "deadbeef"), "blob-content");
  }, 30_000);

  it("creates a backup and restores it, verified against the manifest", async () => {
    backupDir = mkdtempSync(path.join(tmpdir(), "ddas-backup-"));
    const created = await cmdBackupCreate(
      { databaseUrl: sourceUrl, blobDir, out: backupDir },
      quiet
    );
    expect(created).toBe(0);
    const manifest = JSON.parse(
      await readFile(path.join(backupDir, "manifest.json"), "utf8")
    ) as { auditHead: { seq: number }; blobCount: number };
    expect(manifest.auditHead.seq).toBe(3);
    expect(manifest.blobCount).toBe(1);

    const restoreUrl = await emptyDatabase("clirestore");
    const restoreBlobs = mkdtempSync(path.join(tmpdir(), "ddas-restore-blobs-"));
    const restored = await cmdBackupRestore(
      { databaseUrl: restoreUrl, blobDir: restoreBlobs, in: backupDir },
      quiet
    );
    expect(restored).toBe(0);

    const pool = new pg.Pool({ connectionString: restoreUrl, max: 1 });
    const events = await pool.query("SELECT count(*) FROM audit_events");
    expect(Number(events.rows[0].count)).toBe(3);
    await pool.end();
    expect((await readFile(path.join(restoreBlobs, "deadbeef"), "utf8"))).toBe("blob-content");
  }, 60_000);

  it("refuses a non-empty target and fails loudly on a tampered manifest", async () => {
    // Non-empty target: the source db itself.
    const refused = await cmdBackupRestore(
      { databaseUrl: sourceUrl, blobDir, in: backupDir },
      quiet
    );
    expect(refused).toBe(2);

    // Tampered manifest: head hash no longer matches the restored chain.
    const manifestPath = path.join(backupDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      auditHead: { eventHash: string };
    };
    manifest.auditHead.eventHash = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));

    const tamperedTarget = await emptyDatabase("clirestore2");
    const failed = await cmdBackupRestore(
      {
        databaseUrl: tamperedTarget,
        blobDir: mkdtempSync(path.join(tmpdir(), "ddas-restore2-")),
        in: backupDir,
      },
      quiet
    );
    expect(failed).toBe(2);
  }, 60_000);
});
