import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import {
  activePolicyVersionId,
  assertMayAttest,
  assertRequestAccess,
  createRequest,
} from "../domain/requests.js";
import {
  classifyConfirmedFactSet,
  derivationHash,
  factSetFromRows,
  loadCompiledPolicy,
  type FactRow,
} from "../domain/classification.js";
import { transition } from "../domain/request-machine.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import { classify, type Subject } from "@ddas/engine";

const FactOut = z.object({
  factId: z.string(),
  status: z.enum(["FOUND", "NOT_FOUND", "MANUAL"]),
  value: z.unknown().nullable(),
  unit: z.string().nullable(),
  confidence: z.number().nullable(),
  citation: z
    .object({
      docIndex: z.number(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    })
    .nullable(),
  attestedBy: z.string().nullable(),
});

const FactSetOut = z.object({
  id: z.string(),
  version: z.number(),
  status: z.enum(["draft", "confirmed"]),
  extractionModel: z.string().nullable(),
  promptHash: z.string().nullable(),
  facts: z.array(FactOut),
});

const RequestOut = z.object({
  id: z.string(),
  title: z.string(),
  state: z.string(),
  requesterId: z.string(),
  policyVersionId: z.string(),
  actionType: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  documents: z.array(
    z.object({
      id: z.string(),
      docIndex: z.number(),
      name: z.string(),
      sha256: z.string(),
      sizeBytes: z.number(),
    })
  ),
  factSets: z.array(FactSetOut),
  classifications: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["ROUTED", "INCOMPLETE"]),
      tier: z.number().nullable(),
      tierName: z.string().nullable(),
      derivationHash: z.string(),
      missingFacts: z.unknown().nullable(),
      createdAt: z.string(),
    })
  ),
  decision: z
    .object({ outcome: z.string(), decidedBy: z.string().nullable(), decidedAt: z.string() })
    .nullable(),
});

async function factRowsOut(ctx: AppContext, factSetId: string) {
  const rows = await ctx.pool.query<FactRow>(
    `SELECT fact_id, status, value, unit, confidence, citation_doc_index,
            citation_start, citation_end, citation_text, attested_by
     FROM facts WHERE fact_set_id = $1 ORDER BY fact_id`,
    [factSetId]
  );
  return rows.rows.map((f) => ({
    factId: f.fact_id,
    status: f.status,
    value: f.value ?? null,
    unit: f.unit,
    confidence: f.confidence,
    citation:
      f.citation_doc_index !== null &&
      f.citation_start !== null &&
      f.citation_end !== null &&
      f.citation_text !== null
        ? {
            docIndex: f.citation_doc_index,
            start: f.citation_start,
            end: f.citation_end,
            text: f.citation_text,
          }
        : null,
    attestedBy: f.attested_by,
  }));
}

export function registerRequestRoutes(app: App, ctx: AppContext): void {
  app.post(
    "/requests",
    {
      schema: { tags: ["requests"] },
      preHandler: [app.requireRole("requester"), app.requireScope("requests:write")],
    },
    async (request) => {
      // Multipart: fields title (required), policySlug (required), actionType?;
      // one or more .txt/.md files.
      const fields: Record<string, string> = {};
      const files: Array<{ name: string; content: Buffer }> = [];
      for await (const part of request.parts()) {
        if (part.type === "file") {
          files.push({ name: part.filename ?? "document.txt", content: await part.toBuffer() });
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      const title = fields["title"];
      const policySlug = fields["policySlug"];
      if (!title || !policySlug) {
        throw new ApiError("validation_failed", "title and policySlug are required");
      }
      const requestId = await createRequest(ctx, {
        requesterId: request.principal!.id,
        policyVersionId: await activePolicyVersionId(ctx, policySlug),
        title,
        actionType: fields["actionType"],
        documents: files,
        actor: { kind: "principal", id: request.principal!.id },
        meta: { policySlug },
      });
      return { id: requestId, state: "extracting" };
    }
  );

  app.get(
    "/requests",
    {
      schema: {
        tags: ["requests"],
        querystring: z.object({
          state: z.string().optional(),
          mine: z.coerce.boolean().default(false),
        }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              state: z.string(),
              requesterId: z.string(),
              createdAt: z.string(),
            })
          ),
        },
      },
      preHandler: [app.requireAuth, app.requireScope("requests:read")],
    },
    async (request) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (request.query.state) {
        params.push(request.query.state);
        clauses.push(`state = $${params.length}`);
      }
      if (request.query.mine) {
        params.push(request.principal!.id);
        clauses.push(`requester_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await ctx.pool.query<{
        id: string;
        title: string;
        state: string;
        requester_id: string;
        created_at: Date;
      }>(
        `SELECT id, title, state, requester_id, created_at FROM requests ${where} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        state: r.state,
        requesterId: r.requester_id,
        createdAt: r.created_at.toISOString(),
      }));
    }
  );

  app.get(
    "/requests/:id",
    {
      schema: {
        tags: ["requests"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: RequestOut },
      },
      preHandler: [app.requireAuth, app.requireScope("requests:read")],
    },
    async (request) => {
      const { id } = request.params;
      const requestRow = await ctx.pool.query<{
        id: string;
        title: string;
        state: string;
        requester_id: string;
        policy_version_id: string;
        action_type: string | null;
        failure_reason: string | null;
        created_at: Date;
      }>("SELECT * FROM requests WHERE id = $1", [id]);
      const req = requestRow.rows[0];
      if (!req) throw new ApiError("not_found", "request not found");
      await assertRequestAccess(ctx.pool, id, request.principal!, "read");

      const docs = await ctx.pool.query<{
        id: string;
        doc_index: number;
        name: string;
        sha256: string;
        size_bytes: number;
      }>(
        "SELECT id, doc_index, name, sha256, size_bytes FROM documents WHERE request_id = $1 ORDER BY doc_index",
        [id]
      );
      const factSets = await ctx.pool.query<{
        id: string;
        version: number;
        status: "draft" | "confirmed";
        extraction_model: string | null;
        prompt_hash: string | null;
      }>(
        "SELECT id, version, status, extraction_model, prompt_hash FROM fact_sets WHERE request_id = $1 ORDER BY version",
        [id]
      );
      const classifications = await ctx.pool.query<{
        id: string;
        status: "ROUTED" | "INCOMPLETE";
        tier: number | null;
        tier_name: string | null;
        derivation_hash: string;
        missing_facts: unknown;
        created_at: Date;
      }>(
        `SELECT id, status, tier, tier_name, derivation_hash, missing_facts, created_at
         FROM classifications WHERE request_id = $1 ORDER BY created_at`,
        [id]
      );
      const decision = await ctx.pool.query<{
        outcome: string;
        decided_by: string | null;
        decided_at: Date;
      }>("SELECT outcome, decided_by, decided_at FROM decisions WHERE request_id = $1", [id]);

      return {
        id: req.id,
        title: req.title,
        state: req.state,
        requesterId: req.requester_id,
        policyVersionId: req.policy_version_id,
        actionType: req.action_type,
        failureReason: req.failure_reason,
        createdAt: req.created_at.toISOString(),
        documents: docs.rows.map((d) => ({
          id: d.id,
          docIndex: d.doc_index,
          name: d.name,
          sha256: d.sha256,
          sizeBytes: Number(d.size_bytes),
        })),
        factSets: await Promise.all(
          factSets.rows.map(async (fs) => ({
            id: fs.id,
            version: fs.version,
            status: fs.status,
            extractionModel: fs.extraction_model,
            promptHash: fs.prompt_hash,
            facts: await factRowsOut(ctx, fs.id),
          }))
        ),
        classifications: classifications.rows.map((c) => ({
          id: c.id,
          status: c.status,
          tier: c.tier,
          tierName: c.tier_name,
          derivationHash: c.derivation_hash,
          missingFacts: c.missing_facts,
          createdAt: c.created_at.toISOString(),
        })),
        decision: decision.rows[0]
          ? {
              outcome: decision.rows[0].outcome,
              decidedBy: decision.rows[0].decided_by,
              decidedAt: decision.rows[0].decided_at.toISOString(),
            }
          : null,
      };
    }
  );

  app.get(
    "/documents/:id/text",
    {
      schema: {
        tags: ["requests"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ id: z.string(), name: z.string(), text: z.string() }),
        },
      },
      preHandler: [app.requireAuth, app.requireScope("requests:read")],
    },
    async (request) => {
      const rows = await ctx.pool.query<{
        id: string;
        name: string;
        request_id: string;
        extracted_text: string;
      }>(
        "SELECT id, name, request_id, extracted_text FROM documents WHERE id = $1",
        [request.params.id]
      );
      const doc = rows.rows[0];
      if (!doc) throw new ApiError("not_found", "document not found");
      await assertRequestAccess(ctx.pool, doc.request_id, request.principal!, "read");
      return { id: doc.id, name: doc.name, text: doc.extracted_text };
    }
  );

  // ---------- fact review ----------

  const FactPatch = z
    .object({
      status: z.enum(["FOUND", "NOT_FOUND", "MANUAL"]),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
      unit: z.string().optional(),
      citation: z
        .object({
          docIndex: z.number().int().nonnegative(),
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .superRefine((patch, refCtx) => {
      if (patch.status === "MANUAL" && patch.value === undefined) {
        refCtx.addIssue({ code: z.ZodIssueCode.custom, message: "MANUAL requires a value" });
      }
      if (patch.status === "NOT_FOUND" && patch.value !== undefined) {
        refCtx.addIssue({ code: z.ZodIssueCode.custom, message: "NOT_FOUND cannot carry a value" });
      }
      if (patch.status === "FOUND" && (patch.value === undefined || patch.citation === undefined)) {
        refCtx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "FOUND requires a value and a citation",
        });
      }
    });

  app.patch(
    "/fact-sets/:id/facts/:factId",
    {
      schema: {
        tags: ["facts"],
        params: z.object({ id: z.string().uuid(), factId: z.string() }),
        body: FactPatch,
        response: { 200: FactOut },
      },
      preHandler: [app.requireRole("requester", "approver"), app.requireScope("facts:attest")],
    },
    async (request) => {
      const { id, factId } = request.params;
      const patch = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };

      return withTx(ctx.pool, async (client) => {
        const setRow = await client.query<{ id: string; status: string; request_id: string }>(
          "SELECT id, status, request_id FROM fact_sets WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!setRow.rows[0]) throw new ApiError("not_found", "fact set not found");
        await assertRequestAccess(client, setRow.rows[0].request_id, request.principal!, "write");
        if (setRow.rows[0].status !== "draft") {
          throw new ApiError("state_conflict", "fact set is confirmed and frozen — corrections need a new version");
        }

        if (patch.status === "MANUAL") {
          // Attestation-required facts demand a HUMAN attester.
          const requestPolicyRow = await client.query<{ policy_version_id: string }>(
            "SELECT policy_version_id FROM requests WHERE id = $1",
            [setRow.rows[0].request_id]
          );
          const { compiled } = await loadCompiledPolicy(
            client,
            requestPolicyRow.rows[0]!.policy_version_id
          );
          assertMayAttest(compiled, factId, request.principal!.kind);
        }

        let citationText: string | null = null;
        if (patch.status === "FOUND" && patch.citation) {
          // The stored citation must be literally true: read the span from the document.
          const doc = await client.query<{ extracted_text: string }>(
            "SELECT extracted_text FROM documents WHERE request_id = $1 AND doc_index = $2",
            [setRow.rows[0].request_id, patch.citation.docIndex]
          );
          if (!doc.rows[0]) throw new ApiError("validation_failed", "citation docIndex out of range");
          const text = doc.rows[0].extracted_text;
          if (patch.citation.end > text.length || patch.citation.start >= patch.citation.end) {
            throw new ApiError("validation_failed", "citation span out of range");
          }
          citationText = text.slice(patch.citation.start, patch.citation.end);
        }

        const attestedBy = patch.status === "MANUAL" ? request.principal!.id : null;
        const updated = await client.query<{ fact_id: string }>(
          `UPDATE facts SET status = $3, value = $4, unit = $5,
                 citation_doc_index = $6, citation_start = $7, citation_end = $8,
                 citation_text = $9, attested_by = $10, confidence = NULL
           WHERE fact_set_id = $1 AND fact_id = $2 RETURNING fact_id`,
          [
            id,
            factId,
            patch.status,
            patch.value === undefined ? null : JSON.stringify(patch.value),
            patch.unit ?? null,
            patch.citation?.docIndex ?? null,
            patch.citation?.start ?? null,
            patch.citation?.end ?? null,
            citationText,
            attestedBy,
          ]
        );
        if (!updated.rows[0]) throw new ApiError("not_found", `fact "${factId}" not in this set`);

        await appendAuditEvent(client, {
          actor,
          type: patch.status === "MANUAL" ? "fact.attested" : "fact.corrected",
          entity: { type: "fact_set", id },
          payload: { factId, status: patch.status },
        });

        const rows = await client.query<FactRow>(
          `SELECT fact_id, status, value, unit, confidence, citation_doc_index,
                  citation_start, citation_end, citation_text, attested_by
           FROM facts WHERE fact_set_id = $1 AND fact_id = $2`,
          [id, factId]
        );
        const f = rows.rows[0]!;
        return {
          factId: f.fact_id,
          status: f.status,
          value: f.value ?? null,
          unit: f.unit,
          confidence: f.confidence,
          citation:
            f.citation_doc_index !== null && f.citation_text !== null
              ? {
                  docIndex: f.citation_doc_index,
                  start: f.citation_start!,
                  end: f.citation_end!,
                  text: f.citation_text,
                }
              : null,
          attestedBy: f.attested_by,
        };
      });
    }
  );

  app.post(
    "/fact-sets/:id/confirm",
    {
      schema: {
        tags: ["facts"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            classificationId: z.string(),
            status: z.enum(["ROUTED", "INCOMPLETE"]),
            tier: z.number().nullable(),
            tierName: z.string().nullable(),
            routing: z.object({
              kind: z.enum(["auto_approved", "task_created", "incomplete"]),
              taskId: z.string().optional(),
              quorum: z.number().optional(),
              routingFailed: z.boolean().optional(),
            }),
            missingFacts: z.unknown().optional(),
          }),
        },
      },
      preHandler: [app.requireRole("requester", "approver"), app.requireScope("requests:write")],
    },
    async (request) => {
      const { id } = request.params;
      const actor = { kind: "principal" as const, id: request.principal!.id };

      const outcome = await withTx(ctx.pool, async (client) => {
        const setRow = await client.query<{ id: string; status: string; request_id: string }>(
          "SELECT id, status, request_id FROM fact_sets WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!setRow.rows[0]) throw new ApiError("not_found", "fact set not found");
        await assertRequestAccess(client, setRow.rows[0].request_id, request.principal!, "write");
        if (setRow.rows[0].status !== "draft") {
          throw new ApiError("state_conflict", "fact set already confirmed");
        }
        return classifyConfirmedFactSet(client, {
          requestId: setRow.rows[0].request_id,
          factSetId: id,
          actor,
          boss: ctx.boss,
        });
      });

      ctx.counters.classifications.inc({ status: outcome.result.status });
      if (outcome.routing.kind === "auto_approved") {
        ctx.counters.decisions.inc({ outcome: "auto_approved" });
      }

      return {
        classificationId: outcome.classificationId,
        status: outcome.result.status,
        tier: outcome.result.status === "ROUTED" ? outcome.result.tier : null,
        tierName: outcome.result.status === "ROUTED" ? outcome.result.tierName : null,
        routing:
          outcome.routing.kind === "task_created"
            ? {
                kind: "task_created" as const,
                taskId: outcome.routing.taskId,
                quorum: outcome.routing.quorum,
                routingFailed: outcome.routing.routingFailed,
              }
            : { kind: outcome.routing.kind },
        ...(outcome.result.status === "INCOMPLETE"
          ? { missingFacts: outcome.result.missingFacts }
          : {}),
      };
    }
  );

  // Re-open review: clone the latest confirmed set as a new draft version.
  app.post(
    "/fact-sets/:id/clone",
    {
      schema: {
        tags: ["facts"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ id: z.string(), version: z.number() }) },
      },
      preHandler: [app.requireRole("requester", "approver"), app.requireScope("requests:write")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const source = await client.query<{
          id: string;
          request_id: string;
          extraction_model: string | null;
          prompt_hash: string | null;
        }>("SELECT id, request_id, extraction_model, prompt_hash FROM fact_sets WHERE id = $1", [
          request.params.id,
        ]);
        if (!source.rows[0]) throw new ApiError("not_found", "fact set not found");
        const requestId = source.rows[0].request_id;
        await assertRequestAccess(client, requestId, request.principal!, "write");
        // Cloning is only for re-opening review: an INCOMPLETE request (in
        // facts_review) or a classified-but-not-yet-routed one. A request with
        // an open approval task must be cancelled first; a decided/cancelled
        // one is terminal.
        const state = await client.query<{ state: string }>(
          "SELECT state FROM requests WHERE id = $1 FOR UPDATE",
          [requestId]
        );
        const current = state.rows[0]?.state;
        if (current !== "facts_review" && current !== "classified") {
          throw new ApiError(
            "state_conflict",
            `cannot re-open a request in state "${current}" — cancel any pending approval first`
          );
        }
        const nextVersion = await client.query<{ next: number }>(
          "SELECT coalesce(max(version), 0) + 1 AS next FROM fact_sets WHERE request_id = $1",
          [requestId]
        );
        const created = await client.query<{ id: string; version: number }>(
          `INSERT INTO fact_sets (request_id, version, status, extraction_model, prompt_hash)
           VALUES ($1, $2, 'draft', $3, $4) RETURNING id, version`,
          [
            requestId,
            nextVersion.rows[0]!.next,
            source.rows[0].extraction_model,
            source.rows[0].prompt_hash,
          ]
        );
        await client.query(
          `INSERT INTO facts (fact_set_id, fact_id, status, value, unit, confidence,
                              citation_doc_index, citation_start, citation_end, citation_text, attested_by)
           SELECT $2, fact_id, status, value, unit, confidence,
                  citation_doc_index, citation_start, citation_end, citation_text, attested_by
           FROM facts WHERE fact_set_id = $1`,
          [request.params.id, created.rows[0]!.id]
        );
        // A classified request goes back to facts_review; an INCOMPLETE one
        // (already in facts_review) stays put.
        if (current === "classified") {
          await transition(client, requestId, "facts_review", actor, {
            reason: "fact set re-opened",
          });
        }
        return { id: created.rows[0]!.id, version: created.rows[0]!.version };
      });
    }
  );

  // ---------- classifications ----------

  app.get(
    "/classifications/:id",
    {
      schema: {
        tags: ["classifications"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            id: z.string(),
            requestId: z.string(),
            factSetId: z.string(),
            policyVersionId: z.string(),
            engineVersion: z.string(),
            status: z.enum(["ROUTED", "INCOMPLETE"]),
            tier: z.number().nullable(),
            tierName: z.string().nullable(),
            derivation: z.unknown(),
            derivationHash: z.string(),
            missingFacts: z.unknown().nullable(),
            createdAt: z.string(),
          }),
        },
      },
      preHandler: [app.requireAuth, app.requireScope("requests:read")],
    },
    async (request) => {
      const rows = await ctx.pool.query<{
        id: string;
        request_id: string;
        fact_set_id: string;
        policy_version_id: string;
        engine_version: string;
        status: "ROUTED" | "INCOMPLETE";
        tier: number | null;
        tier_name: string | null;
        derivation: unknown;
        derivation_hash: string;
        missing_facts: unknown;
        created_at: Date;
      }>("SELECT * FROM classifications WHERE id = $1", [request.params.id]);
      const c = rows.rows[0];
      if (!c) throw new ApiError("not_found", "classification not found");
      await assertRequestAccess(ctx.pool, c.request_id, request.principal!, "read");
      return {
        id: c.id,
        requestId: c.request_id,
        factSetId: c.fact_set_id,
        policyVersionId: c.policy_version_id,
        engineVersion: c.engine_version,
        status: c.status,
        tier: c.tier,
        tierName: c.tier_name,
        derivation: c.derivation,
        derivationHash: c.derivation_hash,
        missingFacts: c.missing_facts,
        createdAt: c.created_at.toISOString(),
      };
    }
  );

  // The audit procedure as an endpoint: replay (facts, policy version) through
  // the pinned engine and compare derivation hashes.
  app.post(
    "/classifications/:id/replay",
    {
      schema: {
        tags: ["classifications"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            match: z.boolean(),
            storedHash: z.string(),
            replayedHash: z.string(),
            engineVersion: z.string(),
            storedEngineVersion: z.string(),
          }),
        },
      },
      preHandler: [app.requireRole("auditor", "approver", "policy_author")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const rows = await client.query<{
          id: string;
          request_id: string;
          fact_set_id: string;
          policy_version_id: string;
          engine_version: string;
          derivation_hash: string;
        }>(
          "SELECT id, request_id, fact_set_id, policy_version_id, engine_version, derivation_hash FROM classifications WHERE id = $1",
          [request.params.id]
        );
        const stored = rows.rows[0];
        if (!stored) throw new ApiError("not_found", "classification not found");

        const requestRow = await client.query<{
          requester_id: string;
          action_type: string | null;
        }>("SELECT requester_id, action_type FROM requests WHERE id = $1", [stored.request_id]);
        const requester = await client.query<{
          kind: "human" | "agent";
          owner_principal_id: string | null;
        }>("SELECT kind, owner_principal_id FROM principals WHERE id = $1", [
          requestRow.rows[0]!.requester_id,
        ]);
        const factSetMeta = await client.query<{
          extraction_model: string | null;
          prompt_hash: string | null;
        }>("SELECT extraction_model, prompt_hash FROM fact_sets WHERE id = $1", [
          stored.fact_set_id,
        ]);
        const factRows = await client.query<FactRow>(
          `SELECT fact_id, status, value, unit, confidence, citation_doc_index,
                  citation_start, citation_end, citation_text, attested_by
           FROM facts WHERE fact_set_id = $1 ORDER BY fact_id`,
          [stored.fact_set_id]
        );
        const documents = await client.query<{ name: string; sha256: string }>(
          "SELECT name, sha256 FROM documents WHERE request_id = $1 ORDER BY doc_index",
          [stored.request_id]
        );
        const { compiled } = await loadCompiledPolicy(client, stored.policy_version_id);

        const subject: Subject = {
          initiatorKind: requester.rows[0]!.kind,
          initiator: requestRow.rows[0]!.requester_id,
          ...(requester.rows[0]!.kind === "agent" && requester.rows[0]!.owner_principal_id
            ? { onBehalfOf: requester.rows[0]!.owner_principal_id }
            : {}),
          ...(requestRow.rows[0]!.action_type
            ? { actionType: requestRow.rows[0]!.action_type }
            : {}),
        };
        const replayed = classify({
          factSet: factSetFromRows(factRows.rows, {
            model: factSetMeta.rows[0]!.extraction_model,
            promptHash: factSetMeta.rows[0]!.prompt_hash,
          }),
          policy: compiled,
          subject,
          documents: documents.rows.map((d) => ({ name: d.name, sha256: d.sha256 })),
        });
        const replayedHash = derivationHash(replayed.derivation);
        const match = replayedHash === stored.derivation_hash;

        await appendAuditEvent(client, {
          actor,
          type: "classification.replayed",
          entity: { type: "classification", id: stored.id },
          payload: { match, storedHash: stored.derivation_hash, replayedHash },
        });

        return {
          match,
          storedHash: stored.derivation_hash,
          replayedHash,
          engineVersion: replayed.derivation.engineVersion,
          storedEngineVersion: stored.engine_version,
        };
      });
    }
  );

  // Cancel
  app.post(
    "/requests/:id/cancel",
    {
      schema: {
        tags: ["requests"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ state: z.string() }) },
      },
      preHandler: [app.requireRole("requester"), app.requireScope("requests:write")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      await withTx(ctx.pool, async (client) => {
        const row = await client.query<{ requester_id: string }>(
          "SELECT requester_id FROM requests WHERE id = $1",
          [request.params.id]
        );
        if (!row.rows[0]) throw new ApiError("not_found", "request not found");
        if (
          row.rows[0].requester_id !== request.principal!.id &&
          !request.principal!.roles.includes("admin")
        ) {
          throw new ApiError("forbidden", "only the requester or an admin can cancel");
        }
        await transition(client, request.params.id, "cancelled", actor);
        await client.query(
          "UPDATE approval_tasks SET status = 'failed' WHERE request_id = $1 AND status = 'open'",
          [request.params.id]
        );
        await appendAuditEvent(client, {
          actor,
          type: "request.cancelled",
          entity: { type: "request", id: request.params.id },
          payload: {},
        });
      });
      return { state: "cancelled" };
    }
  );
}
