import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { appendAuditEvent } from "@ddas/audit";
import { createBlobStore, type BlobStore } from "@ddas/blob";
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

const fsStore = (dir: string): Promise<BlobStore> => createBlobStore({ driver: "fs", dir });

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
      { databaseUrl: sourceUrl, blobs: await fsStore(blobDir), out: backupDir },
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
      { databaseUrl: restoreUrl, blobs: await fsStore(restoreBlobs), in: backupDir },
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
      { databaseUrl: sourceUrl, blobs: await fsStore(blobDir), in: backupDir },
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
        blobs: await fsStore(mkdtempSync(path.join(tmpdir(), "ddas-restore2-"))),
        in: backupDir,
      },
      quiet
    );
    expect(failed).toBe(2);
  }, 60_000);
});

// --- s3 driver round-trip: same manifest, same verification, blobs come and
// go through a bucket. Needs MinIO (TEST_S3_ENDPOINT) on top of Postgres.
const TEST_S3_ENDPOINT = process.env["TEST_S3_ENDPOINT"];

describe.skipIf(!runnable || !TEST_S3_ENDPOINT)("ddas backup (s3 driver)", () => {
  async function s3Store(): Promise<BlobStore> {
    const bucket = `ddas-cli-backup-${randomBytes(6).toString("hex")}`;
    const credentials = {
      accessKeyId: process.env["TEST_S3_ACCESS_KEY_ID"] ?? "test",
      secretAccessKey: process.env["TEST_S3_SECRET_ACCESS_KEY"] ?? "testtest123",
    };
    const client = new S3Client({
      region: "us-east-1",
      endpoint: TEST_S3_ENDPOINT!,
      forcePathStyle: true,
      credentials,
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    client.destroy();
    return createBlobStore({
      driver: "s3",
      dir: "/unused",
      s3: { endpoint: TEST_S3_ENDPOINT!, region: "us-east-1", bucket, forcePathStyle: true, ...credentials },
    });
  }

  it("backs up blobs from a bucket and restores them into another bucket", async () => {
    const t = await freshTestDb("clibackups3");
    const sourceUrl = testDatabaseUrlFor("clibackups3");
    const client = await t.pool.connect();
    try {
      await client.query("BEGIN");
      await appendAuditEvent(client, {
        actor: { kind: "system" },
        type: "settings.updated",
        entity: { type: "org_settings", id: "singleton" },
        payload: { s3: true },
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await t.close();

    const source = await s3Store();
    const key = "e".repeat(64);
    await source.put(key, Buffer.from("s3 blob content"));

    const backupDir = mkdtempSync(path.join(tmpdir(), "ddas-backup-s3-"));
    expect(await cmdBackupCreate({ databaseUrl: sourceUrl, blobs: source, out: backupDir }, quiet)).toBe(0);
    const manifest = JSON.parse(
      await readFile(path.join(backupDir, "manifest.json"), "utf8")
    ) as { blobCount: number; blobsTar: string | null };
    expect(manifest.blobCount).toBe(1);
    expect(manifest.blobsTar).toBe("blobs.tar.gz");

    const target = await s3Store();
    const restoreUrl = await emptyDatabase("clirestores3");
    expect(await cmdBackupRestore({ databaseUrl: restoreUrl, blobs: target, in: backupDir }, quiet)).toBe(0);
    expect((await target.get(key)).toString()).toBe("s3 blob content");
  }, 120_000);
});
