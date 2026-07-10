/**
 * Background jobs (pg-boss, Postgres-backed — no Redis):
 *  - extraction.run: the ONLY place an LLM is called. retry 2 → request failed.
 *  - sla.check: fires at due_at; on breach re-resolves one tier up and ADDS
 *    approvers (via='escalation'); original approvers stay eligible.
 *  - simulation.run: pure engine replay of stored fact sets. Never the LLM.
 */
import { appendAuditEvent } from "@ddas/audit";
import { extractFacts, type LoadedDoc } from "@ddas/extraction";
import { resolveEscalation } from "@ddas/routing";
import type { App, AppContext } from "../app.js";
import { loadCompiledPolicy } from "../domain/classification.js";
import { loadOrgView, requesterUnitId } from "../domain/org-view.js";
import { transition } from "../domain/request-machine.js";
import { runSimulation } from "../domain/simulation.js";
import { bossDb, withTx } from "../domain/tx.js";

/**
 * Advisory-lock key for queue setup (distinct from the migration, bootstrap,
 * and audit-chain keys). createQueue creates a partition of pg-boss's job
 * table — DDL — and two replicas booting simultaneously deadlock doing it
 * concurrently, so queue creation is serialized cluster-wide.
 */
const QUEUE_SETUP_LOCK_KEY = 7_474_103;

export async function registerJobs(app: App, ctx: AppContext): Promise<void> {
  const boss = ctx.boss;
  if (!boss) return;

  const client = await ctx.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [QUEUE_SETUP_LOCK_KEY]);
    try {
      await boss.createQueue("extraction.run");
      await boss.createQueue("sla.check");
      await boss.createQueue("simulation.run");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [QUEUE_SETUP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }

  await boss.work<{ requestId: string }>(
    "extraction.run",
    { includeMetadata: true },
    async ([job]) => {
    if (!job) return;
    const { requestId } = job.data;
    try {
      await runExtraction(ctx, requestId);
      ctx.counters.extractionRuns.inc({ outcome: "completed" });
    } catch (err) {
      ctx.counters.extractionRuns.inc({ outcome: "failed" });
      app.log.error({ err, requestId }, "extraction failed");
      const meta = job as unknown as { retryLimit?: number; retryCount?: number };
      const retriesLeft = (meta.retryLimit ?? 0) - (meta.retryCount ?? 0);
      if (retriesLeft <= 0) {
        await withTx(ctx.pool, async (client) => {
          await client.query("UPDATE requests SET failure_reason = $2 WHERE id = $1", [
            requestId,
            String(err),
          ]);
          await transition(client, requestId, "failed", { kind: "system" }, {
            reason: String(err),
          });
          await appendAuditEvent(client, {
            actor: { kind: "system" },
            type: "extraction.failed",
            entity: { type: "request", id: requestId },
            payload: { error: String(err), final: true },
          });
        });
      }
      throw err; // let boss count the retry
    }
    }
  );

  await boss.work<{ taskId: string }>("sla.check", async ([job]) => {
    if (!job) return;
    await runSlaCheck(ctx, job.data.taskId);
  });

  await boss.work<{ runId: string }>("simulation.run", async ([job]) => {
    if (!job) return;
    await runSimulation(ctx.pool, job.data.runId);
  });
}

export async function runExtraction(ctx: AppContext, requestId: string): Promise<void> {
  const provider = ctx.extractionProvider;
  if (!provider) {
    throw new Error(
      "no extraction provider configured (set DDAS_EXTRACTION_PROVIDER + credentials, or DDAS_EXTRACTION_PROVIDER=stub)"
    );
  }

  const requestRow = await ctx.pool.query<{ policy_version_id: string; state: string }>(
    "SELECT policy_version_id, state FROM requests WHERE id = $1",
    [requestId]
  );
  const request = requestRow.rows[0];
  if (!request) throw new Error(`request ${requestId} not found`);
  if (request.state !== "extracting") return; // idempotent re-delivery guard

  const documents = await ctx.pool.query<{
    name: string;
    sha256: string;
    extracted_text: string;
  }>(
    "SELECT name, sha256, extracted_text FROM documents WHERE request_id = $1 ORDER BY doc_index",
    [requestId]
  );
  const docs: LoadedDoc[] = documents.rows.map((d) => ({
    name: d.name,
    sha256: d.sha256,
    text: d.extracted_text,
  }));

  const client = await ctx.pool.connect();
  let compiled;
  try {
    compiled = (await loadCompiledPolicy(client, request.policy_version_id)).compiled;
  } finally {
    client.release();
  }

  await withTx(ctx.pool, async (tx) => {
    await appendAuditEvent(tx, {
      actor: { kind: "system" },
      type: "extraction.started",
      entity: { type: "request", id: requestId },
      payload: { provider: provider.id, model: provider.model },
    });
  });

  const { factSet, report } = await extractFacts(docs, compiled, provider);

  await withTx(ctx.pool, async (tx) => {
    const nextVersion = await tx.query<{ next: number }>(
      "SELECT coalesce(max(version), 0) + 1 AS next FROM fact_sets WHERE request_id = $1",
      [requestId]
    );
    const created = await tx.query<{ id: string }>(
      `INSERT INTO fact_sets (request_id, version, status, extraction_model, prompt_hash)
       VALUES ($1, $2, 'draft', $3, $4) RETURNING id`,
      [requestId, nextVersion.rows[0]!.next, report.model, report.promptHash]
    );
    const factSetId = created.rows[0]!.id;
    for (const fact of factSet.facts) {
      await tx.query(
        `INSERT INTO facts (fact_set_id, fact_id, status, value, unit, confidence,
                            citation_doc_index, citation_start, citation_end, citation_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          factSetId,
          fact.id,
          fact.status,
          fact.value === undefined ? null : JSON.stringify(fact.value),
          fact.unit ?? null,
          fact.confidence ?? null,
          fact.citation?.docIndex ?? null,
          fact.citation?.span[0] ?? null,
          fact.citation?.span[1] ?? null,
          fact.citation?.text ?? null,
        ]
      );
    }
    await transition(tx, requestId, "facts_review", { kind: "system" }, { factSetId });
    await appendAuditEvent(tx, {
      actor: { kind: "system" },
      type: "extraction.completed",
      entity: { type: "fact_set", id: factSetId },
      payload: {
        requestId,
        found: report.found,
        notFound: report.notFound,
        citationsRetried: report.citationsRetried.length,
        promptHash: report.promptHash,
      },
    });
  });
}

export async function runSlaCheck(ctx: AppContext, taskId: string): Promise<void> {
  await withTx(ctx.pool, async (client) => {
    const tasks = await client.query<{
      id: string;
      request_id: string;
      required_tier: number;
      quorum: number;
      escalation_level: number;
      status: string;
      due_at: Date;
    }>("SELECT * FROM approval_tasks WHERE id = $1 FOR UPDATE", [taskId]);
    const task = tasks.rows[0];
    if (!task || task.status !== "open") return; // decided in time — nothing to do
    if (task.due_at.getTime() > Date.now()) {
      // Early delivery / clock skew: re-arm for the real due time rather than
      // silently dropping the check — otherwise the escalation chain dies here.
      if (ctx.boss) {
        await ctx.boss.send(
          "sla.check",
          { taskId },
          { startAfter: task.due_at, db: bossDb(client) }
        );
      }
      return;
    }

    const requestRow = await client.query<{ requester_id: string }>(
      "SELECT requester_id FROM requests WHERE id = $1",
      [task.request_id]
    );
    const requesterId = requestRow.rows[0]!.requester_id;
    const now = new Date();
    const level = task.escalation_level + 1;

    const org = await loadOrgView(client);
    const unitId = await requesterUnitId(client, requesterId, now);
    const existing = await client.query<{ principal_id: string }>(
      "SELECT principal_id FROM approval_task_approvers WHERE task_id = $1",
      [taskId]
    );

    let added = 0;
    if (unitId) {
      const escalation = resolveEscalation(
        org,
        {
          requesterId,
          requesterUnitId: unitId,
          requiredTier: task.required_tier,
          asOf: now.toISOString(),
        },
        level,
        existing.rows.map((r) => r.principal_id)
      );
      for (const approver of escalation.added) {
        await client.query(
          `INSERT INTO approval_task_approvers (task_id, principal_id, via, source_id)
           VALUES ($1, $2, 'escalation', NULL) ON CONFLICT DO NOTHING`,
          [taskId, approver.principalId]
        );
        added += 1;
      }
    }

    const slaRow = await client.query<{ sla_hours_by_tier: Record<string, number> }>(
      "SELECT sla_hours_by_tier FROM org_settings WHERE id = TRUE"
    );
    const hours =
      slaRow.rows[0]?.sla_hours_by_tier?.[String(task.required_tier)] ?? 24;
    const nextDue = new Date(now.getTime() + hours * 3600_000);
    await client.query(
      "UPDATE approval_tasks SET escalation_level = $2, due_at = $3 WHERE id = $1",
      [taskId, level, nextDue]
    );
    await appendAuditEvent(client, {
      actor: { kind: "system" },
      type: "approval_task.escalated",
      entity: { type: "approval_task", id: taskId },
      payload: { level, added, nextDueAt: nextDue.toISOString() },
    });

    if (ctx.boss) {
      await ctx.boss.send("sla.check", { taskId }, { startAfter: nextDue });
    }
  });
}
