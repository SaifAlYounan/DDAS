#!/usr/bin/env node
import { Command } from "commander";
import {
  cmdClassify,
  cmdEval,
  cmdPolicyActivate,
  cmdPolicyLint,
  cmdPolicyList,
  cmdPolicyRegister,
  cmdPolicyShow,
  cmdSimulate,
  cmdSubmit,
  type Output,
} from "./commands.js";
import { openStore } from "./store.js";

const out: Output = {
  log: (l) => console.log(l),
  error: (l) => console.error(l),
};

const program = new Command()
  .name("ddas")
  .description("Dynamic Delegation of Authority System — CLI (policy, submit, simulate, eval, migrate, backup)")
  .option("--data-dir <dir>", "storage directory (default ./.ddas or DDAS_DATA_DIR)");

const store = () => openStore(program.opts()["dataDir"]);

const policy = program.command("policy").description("policy-as-code lifecycle");
policy
  .command("lint <file>")
  .description("compile without storing; print findings")
  .action((file) => process.exit(cmdPolicyLint(file, out)));
policy
  .command("register <file>")
  .description("lint-clean → store canonical JSON; prints the content hash")
  .action((file) => process.exit(cmdPolicyRegister(file, store(), out)));
policy
  .command("activate <ref>")
  .description("mark <policy_id>@<version> active (warns without a simulation report)")
  .action((ref) => process.exit(cmdPolicyActivate(ref, store(), out)));
policy
  .command("list")
  .action(() => process.exit(cmdPolicyList(store(), out)));
policy
  .command("show <ref>")
  .action((ref) => process.exit(cmdPolicyShow(ref, store(), out)));

program
  .command("submit <docs...>")
  .description("create a submission from documents (.txt/.md)")
  .option("--facts <file>", "attach a fact set from JSON instead of extracting")
  .option("--extract", "extract facts with the configured LLM provider (DDAS_EXTRACTION_*)")
  .option("--initiator <principal>", "user:<name> or agent:<name>", "user:cli")
  .option("--on-behalf-of <principal>", "accountable human owner (required for agents)")
  .option("--action-type <type>", "normalized action label")
  .action(async (docs, opts) => process.exit(await cmdSubmit(docs, opts, store(), out)));

program
  .command("classify <submissionId>")
  .description("classify a submission under a policy (default: the active one)")
  .option("--policy <ref>", "<policy_id>@<version>")
  .action((id, opts) => process.exit(cmdClassify(id, opts.policy, store(), out)));

program
  .command("simulate <draft.yaml>")
  .description("replay every stored fact set under the draft vs the baseline — zero LLM calls")
  .option("--against <ref>", "baseline policy (default: active)")
  .action((draft, opts) => process.exit(cmdSimulate(draft, opts.against, store(), out)));

program
  .command("eval")
  .description("run the golden-corpus harness")
  .option("--engine", "replay labeled facts through the engine (offline)", true)
  .option("--extraction", "score the configured LLM extractor against the labels (needs API key)")
  .option("--corpus <dir>", "corpus root", new URL("../../../packages/testkit/corpus/kolvarra", import.meta.url).pathname)
  .option("--out <file>", "write the extraction scoreboard JSON here")
  .action(async (opts) => process.exit(await cmdEval(opts, out)));

const backup = program.command("backup").description("backup and restore the whole deployment");
backup
  .command("create")
  .description("pg_dump + blob tarball + manifest with the audit-chain head")
  .requiredOption("--out <dir>", "output directory")
  .option("--database-url <url>", "Postgres connection string (default: DATABASE_URL env)")
  .option("--blob-dir <dir>", "blob directory (default: BLOB_DIR env or /data/blobs)")
  .action(async (opts: { out: string; databaseUrl?: string; blobDir?: string }) => {
    const url = opts.databaseUrl ?? process.env["DATABASE_URL"];
    if (!url) {
      out.error("DATABASE_URL is not set (or pass --database-url)");
      process.exit(2);
    }
    const { cmdBackupCreate } = await import("./backup.js");
    process.exit(
      await cmdBackupCreate(
        {
          databaseUrl: url,
          blobDir: opts.blobDir ?? process.env["BLOB_DIR"] ?? "/data/blobs",
          out: opts.out,
        },
        out
      )
    );
  });
backup
  .command("restore")
  .description("restore a backup into an EMPTY database; verifies the audit chain against the manifest")
  .requiredOption("--in <dir>", "backup directory")
  .option("--database-url <url>", "Postgres connection string (default: DATABASE_URL env)")
  .option("--blob-dir <dir>", "blob directory (default: BLOB_DIR env or /data/blobs)")
  .action(async (opts: { in: string; databaseUrl?: string; blobDir?: string }) => {
    const url = opts.databaseUrl ?? process.env["DATABASE_URL"];
    if (!url) {
      out.error("DATABASE_URL is not set (or pass --database-url)");
      process.exit(2);
    }
    const { cmdBackupRestore } = await import("./backup.js");
    process.exit(
      await cmdBackupRestore(
        {
          databaseUrl: url,
          blobDir: opts.blobDir ?? process.env["BLOB_DIR"] ?? "/data/blobs",
          in: opts.in,
        },
        out
      )
    );
  });

program
  .command("migrate")
  .description("apply pending database migrations (DATABASE_URL)")
  .option("--database-url <url>", "Postgres connection string (default: DATABASE_URL env)")
  .action(async (opts: { databaseUrl?: string }) => {
    const url = opts.databaseUrl ?? process.env["DATABASE_URL"];
    if (!url) {
      out.error("DATABASE_URL is not set (or pass --database-url)");
      process.exit(2);
    }
    const { createDb, createPool, migrate } = await import("@ddas/db");
    const pool = createPool(url);
    try {
      await migrate(createDb(pool));
      out.log("migrations applied — schema is current");
    } finally {
      await pool.end();
    }
  });

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
