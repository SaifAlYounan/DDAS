/**
 * ddas backup create/restore — pg_dump -Fc + a blob tarball + a manifest
 * carrying the audit-chain head. Restore refuses a non-empty database and
 * FAILS LOUDLY when the restored audit chain does not reproduce the
 * manifest's head hash — a backup that can't prove its history is not a
 * backup.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyChain, type Checkpoint } from "@ddas/audit";
import pg from "pg";
import type { Output } from "./commands.js";

interface Manifest {
  version: 1;
  createdAt: string;
  dbDump: string;
  blobsTar: string | null;
  blobCount: number;
  auditHead: Pick<Checkpoint, "seq" | "eventHash"> | null;
}

function run(command: string, args: string[], out: Output): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (err) => reject(new Error(`${command}: ${String(err)}`)));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))
    );
    void out;
  });
}

export async function cmdBackupCreate(
  opts: { databaseUrl: string; blobDir: string; out: string },
  out: Output
): Promise<number> {
  await mkdir(opts.out, { recursive: true });
  const dumpFile = path.join(opts.out, "db.dump");
  await run("pg_dump", ["-Fc", "--no-owner", "-d", opts.databaseUrl, "-f", dumpFile], out);

  let blobsTar: string | null = null;
  let blobCount = 0;
  if (existsSync(opts.blobDir)) {
    blobCount = (await readdir(opts.blobDir)).length;
    if (blobCount > 0) {
      blobsTar = "blobs.tar.gz";
      await run(
        "tar",
        ["-czf", path.join(opts.out, blobsTar), "-C", opts.blobDir, "."],
        out
      );
    }
  }

  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 1 });
  const client = await pool.connect();
  let auditHead: Manifest["auditHead"] = null;
  try {
    const verified = await verifyChain(client);
    if (!verified.ok) {
      out.error(
        `REFUSING to back up a corrupt audit chain: seq ${verified.firstBadSeq} — ${verified.reason}`
      );
      return 2;
    }
    auditHead = verified.head;
  } finally {
    client.release();
    await pool.end();
  }

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    dbDump: "db.dump",
    blobsTar,
    blobCount,
    auditHead,
  };
  await writeFile(path.join(opts.out, "manifest.json"), JSON.stringify(manifest, null, 2));
  out.log(
    `backup written to ${opts.out} (audit head: ${auditHead ? `seq ${auditHead.seq}` : "empty chain"}, blobs: ${blobCount})`
  );
  return 0;
}

export async function cmdBackupRestore(
  opts: { databaseUrl: string; blobDir: string; in: string },
  out: Output
): Promise<number> {
  const manifest = JSON.parse(
    await readFile(path.join(opts.in, "manifest.json"), "utf8")
  ) as Manifest;

  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 1 });
  const preCheck = await pool.query<{ count: string }>(
    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
  );
  if (Number(preCheck.rows[0]!.count) > 0) {
    out.error("REFUSING to restore into a non-empty database");
    await pool.end();
    return 2;
  }

  await run(
    "pg_restore",
    ["--no-owner", "--no-privileges", "-d", opts.databaseUrl, path.join(opts.in, manifest.dbDump)],
    out
  );
  if (manifest.blobsTar) {
    await mkdir(opts.blobDir, { recursive: true });
    await run("tar", ["-xzf", path.join(opts.in, manifest.blobsTar), "-C", opts.blobDir], out);
  }

  const client = await pool.connect();
  try {
    const verified = await verifyChain(client);
    if (!verified.ok) {
      out.error(
        `RESTORE FAILED VERIFICATION: audit chain broken at seq ${verified.firstBadSeq} — ${verified.reason}`
      );
      return 2;
    }
    const head = verified.head;
    const expected = manifest.auditHead;
    const matches =
      (head === null && expected === null) ||
      (head !== null &&
        expected !== null &&
        head.seq === expected.seq &&
        head.eventHash === expected.eventHash);
    if (!matches) {
      out.error(
        `RESTORE FAILED VERIFICATION: audit head ${JSON.stringify(head)} does not match manifest ${JSON.stringify(expected)}`
      );
      return 2;
    }
    out.log(
      `restore verified: audit chain intact${head ? ` through seq ${head.seq}` : " (empty)"}, ${manifest.blobCount} blob(s)`
    );
    return 0;
  } finally {
    client.release();
    await pool.end();
  }
}
