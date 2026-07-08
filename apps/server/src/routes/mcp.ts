/**
 * The MCP surface: an AI agent requests authority through the SAME pipeline,
 * appetite gates, audit trail, and human inbox as everything else. Tools are
 * thin wrappers over the domain functions REST uses — no separate code path.
 *
 * Stateless streamable HTTP: every POST /mcp builds a fresh server+transport
 * bound to the authenticated principal. Agents can never approve — there is
 * no approval tool, no approval scope, and the engine floors agent tiers.
 */
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import { z } from "zod";
import type { App, AppContext } from "../app.js";
import { loadCompiledPolicy } from "../domain/classification.js";
import { classifyConfirmedFactSet } from "../domain/classification.js";
import {
  activePolicyVersionId,
  assertMayAttest,
  createRequest,
} from "../domain/requests.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import type { AuthedApiKey, AuthedPrincipal } from "../plugins/auth.js";

function paramsHash(params: unknown): string {
  return createHash("sha256").update(JSON.stringify(params ?? {})).digest("hex").slice(0, 16);
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function buildMcpServer(
  ctx: AppContext,
  principal: AuthedPrincipal,
  apiKey: AuthedApiKey | null
): McpServer {
  const server = new McpServer({ name: "ddas", version: "2.0.0-alpha.0" });
  const actor: AuditActor = apiKey
    ? { kind: "api_key", id: apiKey.id, principalId: principal.id }
    : { kind: "principal", id: principal.id };

  const audited = async <T>(tool: string, params: unknown, fn: () => Promise<T>): Promise<T> => {
    ctx.counters.mcpCalls.inc({ tool });
    await withTx(ctx.pool, (client) =>
      appendAuditEvent(client, {
        actor,
        type: "mcp.call",
        entity: { type: "principal", id: principal.id },
        payload: { tool, paramsHash: paramsHash(params) },
      })
    );
    return fn();
  };

  /** Own-requests guard: MCP principals only ever see their own requests. */
  const ownRequest = async (requestId: string) => {
    const rows = await ctx.pool.query<{ id: string; requester_id: string; state: string; policy_version_id: string }>(
      "SELECT id, requester_id, state, policy_version_id FROM requests WHERE id = $1",
      [requestId]
    );
    const request = rows.rows[0];
    if (!request || request.requester_id !== principal.id) {
      throw new ApiError("not_found", `request ${requestId} not found`);
    }
    return request;
  };

  server.tool(
    "request_authority",
    "Submit an action for authority classification and routing. Documents are the evidence; facts are extracted with verbatim citations, then classified against the registered risk policy. Returns the request id — poll get_decision_status.",
    {
      title: z.string().min(1),
      policy_slug: z.string().min(1),
      action_type: z.string().optional(),
      documents: z
        .array(z.object({ name: z.string().min(1), content: z.string().min(1) }))
        .min(1),
    },
    async (params) =>
      audited("request_authority", params, async () => {
        const requestId = await createRequest(ctx, {
          requesterId: principal.id,
          policyVersionId: await activePolicyVersionId(ctx, params.policy_slug),
          title: params.title,
          actionType: params.action_type,
          documents: params.documents.map((doc) => ({
            name: doc.name,
            content: Buffer.from(doc.content, "utf8"),
          })),
          actor,
          meta: { via: "mcp", policySlug: params.policy_slug },
        });
        return textResult({
          request_id: requestId,
          state: "extracting",
          next: "poll get_decision_status until state is facts_review, then review/attest facts and confirm_facts",
        });
      })
  );

  server.tool(
    "get_decision_status",
    "The state of one of your requests: pipeline state, classification (tier + explanation), missing facts if incomplete, and the final decision once made.",
    { request_id: z.string().uuid() },
    async (params) =>
      audited("get_decision_status", params, async () => {
        const request = await ownRequest(params.request_id);
        const classification = await ctx.pool.query<{
          status: string;
          tier: number | null;
          tier_name: string | null;
          missing_facts: unknown;
          derivation: { explanation?: string };
        }>(
          `SELECT status, tier, tier_name, missing_facts, derivation
           FROM classifications WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [params.request_id]
        );
        const decision = await ctx.pool.query<{ outcome: string; decided_at: Date }>(
          "SELECT outcome, decided_at FROM decisions WHERE request_id = $1",
          [params.request_id]
        );
        const facts = await ctx.pool.query<{ fact_id: string; status: string; value: unknown }>(
          `SELECT f.fact_id, f.status, f.value
           FROM facts f JOIN fact_sets fs ON fs.id = f.fact_set_id
           WHERE fs.request_id = $1 AND fs.status = 'draft'
           ORDER BY fs.version DESC, f.fact_id`,
          [params.request_id]
        );
        const latest = classification.rows[0];
        return textResult({
          request_id: params.request_id,
          state: request.state,
          draft_facts: facts.rows.map((f) => ({
            id: f.fact_id,
            status: f.status,
            value: f.value,
          })),
          classification: latest
            ? {
                status: latest.status,
                tier: latest.tier,
                tier_name: latest.tier_name,
                missing_facts: latest.missing_facts,
                explanation: latest.derivation?.explanation,
              }
            : null,
          decision: decision.rows[0]
            ? {
                outcome: decision.rows[0].outcome,
                decided_at: decision.rows[0].decided_at.toISOString(),
              }
            : null,
        });
      })
  );

  server.tool(
    "list_my_pending_requests",
    "Your requests that are still in flight (not decided or cancelled).",
    {},
    async () =>
      audited("list_my_pending_requests", {}, async () => {
        const rows = await ctx.pool.query<{
          id: string;
          title: string;
          state: string;
          created_at: Date;
        }>(
          `SELECT id, title, state, created_at FROM requests
           WHERE requester_id = $1 AND state NOT IN ('decided', 'cancelled', 'failed')
           ORDER BY created_at DESC`,
          [principal.id]
        );
        return textResult(
          rows.rows.map((request) => ({
            request_id: request.id,
            title: request.title,
            state: request.state,
            created_at: request.created_at.toISOString(),
          }))
        );
      })
  );

  server.tool(
    "attest_fact",
    "Set a fact on your request's draft fact set as a MANUAL (attested) value. Facts the policy marks attestation-required must be attested by your accountable human owner, not by you.",
    {
      request_id: z.string().uuid(),
      fact_id: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
      unit: z.string().optional(),
    },
    async (params) =>
      audited("attest_fact", params, async () => {
        const request = await ownRequest(params.request_id);
        return withTx(ctx.pool, async (client) => {
          const factSet = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM fact_sets WHERE request_id = $1
             ORDER BY version DESC LIMIT 1 FOR UPDATE`,
            [params.request_id]
          );
          if (!factSet.rows[0] || factSet.rows[0].status !== "draft") {
            throw new ApiError("state_conflict", "no draft fact set to attest on");
          }
          const { compiled } = await loadCompiledPolicy(client, request.policy_version_id);
          assertMayAttest(compiled, params.fact_id, principal.kind);
          const updated = await client.query(
            `UPDATE facts SET status = 'MANUAL', value = $3, unit = $4, confidence = NULL,
                    citation_doc_index = NULL, citation_start = NULL, citation_end = NULL,
                    citation_text = NULL, attested_by = $5
             WHERE fact_set_id = $1 AND fact_id = $2`,
            [
              factSet.rows[0].id,
              params.fact_id,
              JSON.stringify(params.value),
              params.unit ?? null,
              principal.id,
            ]
          );
          if (updated.rowCount === 0) {
            throw new ApiError("not_found", `fact "${params.fact_id}" not in this fact set`);
          }
          await appendAuditEvent(client, {
            actor,
            type: "fact.attested",
            entity: { type: "fact_set", id: factSet.rows[0].id },
            payload: { factId: params.fact_id, via: "mcp" },
          });
          return textResult({ ok: true, fact_id: params.fact_id, status: "MANUAL" });
        });
      })
  );

  server.tool(
    "confirm_facts",
    "Freeze your request's draft fact set and run classification. Returns the tier and routing outcome, or the missing facts if classification is INCOMPLETE.",
    { request_id: z.string().uuid() },
    async (params) =>
      audited("confirm_facts", params, async () => {
        await ownRequest(params.request_id);
        const outcome = await withTx(ctx.pool, async (client) => {
          const factSet = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM fact_sets WHERE request_id = $1
             ORDER BY version DESC LIMIT 1 FOR UPDATE`,
            [params.request_id]
          );
          if (!factSet.rows[0] || factSet.rows[0].status !== "draft") {
            throw new ApiError("state_conflict", "no draft fact set to confirm");
          }
          return classifyConfirmedFactSet(client, {
            requestId: params.request_id,
            factSetId: factSet.rows[0].id,
            actor,
            boss: ctx.boss,
          });
        });
        ctx.counters.classifications.inc({ status: outcome.result.status });
        if (outcome.routing.kind === "auto_approved") {
          ctx.counters.decisions.inc({ outcome: "auto_approved" });
        }
        return textResult({
          request_id: params.request_id,
          classification: outcome.result.status,
          tier: outcome.result.status === "ROUTED" ? outcome.result.tier : null,
          tier_name: outcome.result.status === "ROUTED" ? outcome.result.tierName : null,
          routing: outcome.routing,
          ...(outcome.result.status === "INCOMPLETE"
            ? { missing_facts: outcome.result.missingFacts }
            : {}),
          explanation: outcome.result.derivation.explanation,
        });
      })
  );

  return server;
}

export function registerMcpRoute(app: App, ctx: AppContext): void {
  app.post("/mcp", async (request, reply) => {
    if (!request.principal) {
      throw new ApiError("unauthorized", "MCP requires an API key (Authorization: Bearer ddas_…)");
    }
    if (request.apiKey && !request.apiKey.scopes.includes("mcp")) {
      throw new ApiError("forbidden", 'API key lacks the "mcp" scope');
    }

    const server = buildMcpServer(ctx, request.principal, request.apiKey);
    // Casts: the SDK's option/Transport types trip exactOptionalPropertyTypes;
    // stateless mode (no session id) is the documented configuration.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: one exchange per POST
      enableJsonResponse: true,
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    reply.hijack();
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    request.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
  });
}
