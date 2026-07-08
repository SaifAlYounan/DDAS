/**
 * The confirm → classify → route pipeline. classify() is pure and fast, so it
 * runs SYNCHRONOUSLY inside the confirming transaction: the fact-set freeze,
 * the classification row, the approval task (or auto-decision), the request
 * state change, and every audit event commit atomically or not at all.
 */
import { createHash } from "node:crypto";
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import { classify, type ClassificationResult, type Fact, type FactSet, type Subject } from "@ddas/engine";
import { canonicalize, compileDocument, type CompiledPolicy, type JsonValue } from "@ddas/policy";
import { resolveApprovers, type ResolutionResult } from "@ddas/routing";
import type pg from "pg";
import { ApiError } from "../errors.js";
import { loadOrgView, requesterUnitId } from "./org-view.js";
import { transition } from "./request-machine.js";

export function derivationHash(derivation: unknown): string {
  return createHash("sha256")
    .update(canonicalize(derivation as JsonValue))
    .digest("hex");
}

export interface FactRow {
  fact_id: string;
  status: "FOUND" | "NOT_FOUND" | "MANUAL";
  value: unknown;
  unit: string | null;
  confidence: number | null;
  citation_doc_index: number | null;
  citation_start: number | null;
  citation_end: number | null;
  citation_text: string | null;
  attested_by: string | null;
}

/** Rebuild the engine's FactSet from stored fact rows. */
export function factSetFromRows(
  rows: FactRow[],
  extraction: { model: string | null; promptHash: string | null }
): FactSet {
  const facts: Fact[] = rows.map((row) => {
    const fact: Fact = { id: row.fact_id, status: row.status };
    if (row.value !== null && row.value !== undefined) fact.value = row.value as Fact["value"];
    if (row.unit !== null) fact.unit = row.unit;
    if (row.confidence !== null) fact.confidence = row.confidence;
    if (
      row.citation_doc_index !== null &&
      row.citation_start !== null &&
      row.citation_end !== null &&
      row.citation_text !== null
    ) {
      fact.citation = {
        docIndex: row.citation_doc_index,
        span: [row.citation_start, row.citation_end],
        text: row.citation_text,
      };
    }
    if (row.attested_by !== null) fact.attestedBy = row.attested_by;
    return fact;
  });
  const factSet: FactSet = { facts };
  if (extraction.model && extraction.promptHash) {
    factSet.extraction = { model: extraction.model, promptHash: extraction.promptHash };
  }
  return factSet;
}

export async function loadCompiledPolicy(
  client: pg.ClientBase,
  policyVersionId: string
): Promise<{ compiled: CompiledPolicy; row: { id: string; status: string } }> {
  const result = await client.query<{
    id: string;
    status: string;
    canonical_json: unknown;
    content_hash: string;
  }>(
    "SELECT id, status, canonical_json, content_hash FROM policy_versions WHERE id = $1",
    [policyVersionId]
  );
  const row = result.rows[0];
  if (!row) throw new ApiError("not_found", `policy version ${policyVersionId} not found`);
  const compiled = compileDocument(row.canonical_json);
  if (compiled.contentHash !== row.content_hash) {
    throw new ApiError("internal", "stored canonical_json does not match content_hash", {
      policyVersionId,
    });
  }
  return { compiled, row: { id: row.id, status: row.status } };
}

export interface ClassifyOutcome {
  classificationId: string;
  result: ClassificationResult;
  routing:
    | { kind: "auto_approved" }
    | { kind: "task_created"; taskId: string; approvers: number; quorum: number; routingFailed: boolean }
    | { kind: "incomplete" };
}

/**
 * Run inside the caller's transaction. `request` must already be locked by
 * the caller (transition() locks it again harmlessly).
 */
export async function classifyConfirmedFactSet(
  client: pg.ClientBase,
  args: {
    requestId: string;
    factSetId: string;
    actor: AuditActor;
    now?: Date;
  }
): Promise<ClassifyOutcome> {
  const now = args.now ?? new Date();

  const requestRow = await client.query<{
    id: string;
    requester_id: string;
    policy_version_id: string;
    state: string;
  }>(
    "SELECT id, requester_id, policy_version_id, state FROM requests WHERE id = $1 FOR UPDATE",
    [args.requestId]
  );
  const request = requestRow.rows[0];
  if (!request) throw new ApiError("not_found", `request ${args.requestId} not found`);

  const requesterRow = await client.query<{
    id: string;
    kind: "human" | "agent";
    name: string;
    owner_principal_id: string | null;
  }>("SELECT id, kind, name, owner_principal_id FROM principals WHERE id = $1", [
    request.requester_id,
  ]);
  const requester = requesterRow.rows[0];
  if (!requester) throw new ApiError("internal", "requester principal missing");

  const factSetRow = await client.query<{
    id: string;
    status: string;
    extraction_model: string | null;
    prompt_hash: string | null;
  }>("SELECT id, status, extraction_model, prompt_hash FROM fact_sets WHERE id = $1 AND request_id = $2", [
    args.factSetId,
    args.requestId,
  ]);
  const factSetMeta = factSetRow.rows[0];
  if (!factSetMeta) throw new ApiError("not_found", `fact set ${args.factSetId} not found`);

  const factRows = await client.query<FactRow>(
    `SELECT fact_id, status, value, unit, confidence, citation_doc_index,
            citation_start, citation_end, citation_text, attested_by
     FROM facts WHERE fact_set_id = $1 ORDER BY fact_id`,
    [args.factSetId]
  );
  const documentsRows = await client.query<{ name: string; sha256: string }>(
    "SELECT name, sha256 FROM documents WHERE request_id = $1 ORDER BY doc_index",
    [args.requestId]
  );

  const { compiled } = await loadCompiledPolicy(client, request.policy_version_id);
  const factSet = factSetFromRows(factRows.rows, {
    model: factSetMeta.extraction_model,
    promptHash: factSetMeta.prompt_hash,
  });
  const subject: Subject = {
    initiatorKind: requester.kind,
    initiator: requester.id,
    ...(requester.kind === "agent" && requester.owner_principal_id
      ? { onBehalfOf: requester.owner_principal_id }
      : {}),
  };

  const result = classify({
    factSet,
    policy: compiled,
    subject,
    documents: documentsRows.rows.map((d) => ({ name: d.name, sha256: d.sha256 })),
  });

  // Freeze the fact set (legal: draft → confirmed; the trigger enforces once).
  if (factSetMeta.status === "draft") {
    const confirmedBy = args.actor.kind === "principal" ? args.actor.id : null;
    await client.query(
      "UPDATE fact_sets SET status = 'confirmed', confirmed_at = $2, confirmed_by = $3 WHERE id = $1",
      [args.factSetId, now, confirmedBy]
    );
    await appendAuditEvent(client, {
      actor: args.actor,
      type: "fact_set.confirmed",
      entity: { type: "fact_set", id: args.factSetId },
      payload: { requestId: args.requestId },
    });
  }

  const hash = derivationHash(result.derivation);
  const classificationRow = await client.query<{ id: string }>(
    `INSERT INTO classifications
       (request_id, fact_set_id, policy_version_id, engine_version, status, tier, tier_name, derivation, derivation_hash, missing_facts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      args.requestId,
      args.factSetId,
      request.policy_version_id,
      result.derivation.engineVersion,
      result.status,
      result.status === "ROUTED" ? result.tier : null,
      result.status === "ROUTED" ? result.tierName : null,
      JSON.stringify(result.derivation),
      hash,
      result.status === "INCOMPLETE" ? JSON.stringify(result.missingFacts) : null,
    ]
  );
  const classificationId = classificationRow.rows[0]!.id;
  await appendAuditEvent(client, {
    actor: args.actor,
    type: "classification.created",
    entity: { type: "classification", id: classificationId },
    payload: {
      requestId: args.requestId,
      status: result.status,
      tier: result.status === "ROUTED" ? result.tier : null,
      derivationHash: hash,
      policyContentHash: compiled.contentHash,
    },
  });

  if (result.status === "INCOMPLETE") {
    // Request stays in facts_review — the missing-facts list blocks routing.
    return { classificationId, result, routing: { kind: "incomplete" } };
  }

  await transition(client, args.requestId, "classified", args.actor, { classificationId });

  // Tier 0 = within the requester's own authority: auto-decision.
  if (result.tier === 0) {
    await transition(client, args.requestId, "decided", args.actor, { auto: true });
    const decision = await client.query<{ id: string }>(
      `INSERT INTO decisions (request_id, task_id, outcome, decided_by)
       VALUES ($1, NULL, 'auto_approved', NULL) RETURNING id`,
      [args.requestId]
    );
    await appendAuditEvent(client, {
      actor: args.actor,
      type: "decision.recorded",
      entity: { type: "decision", id: decision.rows[0]!.id },
      payload: { requestId: args.requestId, outcome: "auto_approved", tier: 0 },
    });
    return { classificationId, result, routing: { kind: "auto_approved" } };
  }

  const task = await createApprovalTask(client, {
    requestId: args.requestId,
    classificationId,
    requesterId: request.requester_id,
    tier: result.tier,
    policy: compiled,
    actor: args.actor,
    now,
  });
  await transition(client, args.requestId, "pending_approval", args.actor, {
    taskId: task.taskId,
  });
  return { classificationId, result, routing: { kind: "task_created", ...task } };
}

async function slaHoursForTier(client: pg.ClientBase, tier: number): Promise<number> {
  const settings = await client.query<{ sla_hours_by_tier: Record<string, number> }>(
    "SELECT sla_hours_by_tier FROM org_settings WHERE id = TRUE"
  );
  const byTier = settings.rows[0]?.sla_hours_by_tier ?? {};
  return byTier[String(tier)] ?? 24;
}

export async function createApprovalTask(
  client: pg.ClientBase,
  args: {
    requestId: string;
    classificationId: string;
    requesterId: string;
    tier: number;
    policy: CompiledPolicy;
    actor: AuditActor;
    now: Date;
  }
): Promise<{ taskId: string; approvers: number; quorum: number; routingFailed: boolean }> {
  const ladderEntry = args.policy.document.authority_ladder.find((l) => l.tier === args.tier);
  const quorumRule = (ladderEntry?.quorum ?? 1) as number | "majority";

  const org = await loadOrgView(client);
  const unitId = await requesterUnitId(client, args.requesterId, args.now);

  let resolution: ResolutionResult | null = null;
  if (unitId) {
    resolution = resolveApprovers(org, {
      requesterId: args.requesterId,
      requesterUnitId: unitId,
      requiredTier: args.tier,
      quorum: quorumRule,
      asOf: args.now.toISOString(),
    });
  }

  const routingFailed = !resolution?.ok;
  const dueHours = await slaHoursForTier(client, args.tier);
  const dueAt = new Date(args.now.getTime() + dueHours * 3600_000);

  const trace = resolution
    ? resolution.trace
    : { outcome: "no_eligible_approvers", reason: "no org units registered" };
  const quorum = resolution?.ok ? resolution.quorum : 1;

  const taskRow = await client.query<{ id: string }>(
    `INSERT INTO approval_tasks
       (request_id, classification_id, required_tier, quorum, due_at, status, resolution_trace)
     VALUES ($1, $2, $3, $4, $5, 'open', $6) RETURNING id`,
    [
      args.requestId,
      args.classificationId,
      args.tier,
      quorum,
      dueAt,
      JSON.stringify({ ...trace, routingFailed }),
    ]
  );
  const taskId = taskRow.rows[0]!.id;

  let approverCount = 0;
  if (resolution?.ok) {
    for (const approver of resolution.approvers) {
      await client.query(
        `INSERT INTO approval_task_approvers (task_id, principal_id, via, source_id)
         VALUES ($1, $2, $3, $4)`,
        [taskId, approver.principalId, approver.via, approver.sourceId]
      );
      approverCount += 1;
    }
  } else {
    // Typed routing failure: assign every admin so the task is never orphaned.
    const admins = await client.query<{ principal_id: string }>(
      `SELECT DISTINCT r.principal_id
       FROM role_assignments r JOIN principals p ON p.id = r.principal_id
       WHERE r.role = 'admin' AND p.disabled_at IS NULL AND p.kind = 'human'`
    );
    for (const admin of admins.rows) {
      await client.query(
        `INSERT INTO approval_task_approvers (task_id, principal_id, via, source_id)
         VALUES ($1, $2, 'escalation', NULL)`,
        [taskId, admin.principal_id]
      );
      approverCount += 1;
    }
    await appendAuditEvent(client, {
      actor: args.actor,
      type: "approval_task.routing_failed",
      entity: { type: "approval_task", id: taskId },
      payload: {
        requestId: args.requestId,
        failure: resolution ? resolution.failure : "no_org_units",
        assignedAdmins: approverCount,
      },
    });
  }

  await appendAuditEvent(client, {
    actor: args.actor,
    type: "approval_task.created",
    entity: { type: "approval_task", id: taskId },
    payload: {
      requestId: args.requestId,
      tier: args.tier,
      quorum,
      approvers: approverCount,
      dueAt: dueAt.toISOString(),
      routingFailed,
    },
  });

  return { taskId, approvers: approverCount, quorum, routingFailed };
}
