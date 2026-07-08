import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import {
  canonicalize,
  compilePolicy,
  lintPolicy,
  PolicyCompileError,
  type JsonValue,
  type RiskPolicyV1,
} from "@ddas/policy";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

const LintFindingOut = z.object({
  severity: z.enum(["error", "warning"]),
  path: z.string(),
  message: z.string(),
});

const VersionOut = z.object({
  id: z.string(),
  policyId: z.string(),
  version: z.number(),
  status: z.enum(["draft", "active", "retired"]),
  contentHash: z.string(),
  simulationRunId: z.string().nullable(),
  activationOverrideReason: z.string().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});

function versionRowOut(r: {
  id: string;
  policy_id: string;
  version: number;
  status: "draft" | "active" | "retired";
  content_hash: string;
  simulation_run_id: string | null;
  activation_override_reason: string | null;
  created_at: Date;
  activated_at: Date | null;
}) {
  return {
    id: r.id,
    policyId: r.policy_id,
    version: r.version,
    status: r.status,
    contentHash: r.content_hash,
    simulationRunId: r.simulation_run_id,
    activationOverrideReason: r.activation_override_reason,
    createdAt: r.created_at.toISOString(),
    activatedAt: r.activated_at?.toISOString() ?? null,
  };
}

/** Structural diff of two canonical policy documents (top-level + per-category). */
export function policyDiff(a: RiskPolicyV1, b: RiskPolicyV1): Array<{ path: string; change: "added" | "removed" | "changed" }> {
  const diffs: Array<{ path: string; change: "added" | "removed" | "changed" }> = [];
  const sections: Array<keyof RiskPolicyV1> = [
    "authority_ladder",
    "likelihood_scale",
    "rating_scale",
    "fact_schema",
    "escalation_triggers" as keyof RiskPolicyV1,
    "accumulation" as keyof RiskPolicyV1,
    "agent_policy" as keyof RiskPolicyV1,
    "missing_info" as keyof RiskPolicyV1,
    "reference_lists" as keyof RiskPolicyV1,
    "fx_snapshot" as keyof RiskPolicyV1,
  ];
  for (const section of sections) {
    const av = canonicalize((a[section] ?? null) as JsonValue);
    const bv = canonicalize((b[section] ?? null) as JsonValue);
    if (av !== bv) diffs.push({ path: String(section), change: "changed" });
  }
  const aCats = new Map(a.categories.map((c) => [c.id, c]));
  const bCats = new Map(b.categories.map((c) => [c.id, c]));
  for (const [id, cat] of aCats) {
    if (!bCats.has(id)) diffs.push({ path: `categories/${id}`, change: "removed" });
    else if (canonicalize(cat as unknown as JsonValue) !== canonicalize(bCats.get(id) as unknown as JsonValue)) {
      diffs.push({ path: `categories/${id}`, change: "changed" });
    }
  }
  for (const id of bCats.keys()) {
    if (!aCats.has(id)) diffs.push({ path: `categories/${id}`, change: "added" });
  }
  return diffs;
}

export function registerPolicyRoutes(app: App, ctx: AppContext): void {
  app.post(
    "/policies/lint",
    {
      schema: {
        tags: ["policies"],
        body: z.object({ sourceYaml: z.string().min(1) }),
        response: {
          200: z.object({
            ok: z.boolean(),
            contentHash: z.string().nullable(),
            findings: z.array(LintFindingOut),
          }),
        },
      },
      preHandler: [app.requireRole("policy_author")],
    },
    async (request) => {
      try {
        const compiled = compilePolicy(request.body.sourceYaml);
        const findings = lintPolicy(compiled.document);
        return { ok: true, contentHash: compiled.contentHash, findings };
      } catch (err) {
        if (err instanceof PolicyCompileError) {
          return { ok: false, contentHash: null, findings: err.findings };
        }
        throw new ApiError("validation_failed", `unparseable policy: ${String(err)}`);
      }
    }
  );

  app.get(
    "/policies",
    {
      schema: {
        tags: ["policies"],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              slug: z.string(),
              activeVersion: z.number().nullable(),
              versions: z.number(),
            })
          ),
        },
      },
      preHandler: [app.requireAuth],
    },
    async () => {
      const rows = await ctx.pool.query<{
        id: string;
        slug: string;
        active_version: number | null;
        versions: string;
      }>(
        `SELECT p.id, p.slug,
                max(v.version) FILTER (WHERE v.status = 'active') AS active_version,
                count(v.id) AS versions
         FROM policies p LEFT JOIN policy_versions v ON v.policy_id = p.id
         GROUP BY p.id ORDER BY p.created_at`
      );
      return rows.rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        activeVersion: r.active_version,
        versions: Number(r.versions),
      }));
    }
  );

  app.post(
    "/policies/:slug/versions",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ slug: z.string().min(1) }),
        body: z.object({ sourceYaml: z.string().min(1) }),
        response: { 200: VersionOut },
      },
      preHandler: [app.requireRole("policy_author")],
    },
    async (request) => {
      const { slug } = request.params;
      const { sourceYaml } = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };

      let compiled;
      try {
        compiled = compilePolicy(sourceYaml);
      } catch (err) {
        if (err instanceof PolicyCompileError) {
          throw new ApiError("validation_failed", "policy failed lint", {
            findings: err.findings,
          });
        }
        throw new ApiError("validation_failed", `unparseable policy: ${String(err)}`);
      }

      return withTx(ctx.pool, async (client) => {
        let policyRow = await client.query<{ id: string }>(
          "SELECT id FROM policies WHERE slug = $1 FOR UPDATE",
          [slug]
        );
        let policyId: string;
        if (policyRow.rows[0]) {
          policyId = policyRow.rows[0].id;
        } else {
          const created = await client.query<{ id: string }>(
            "INSERT INTO policies (slug, created_by) VALUES ($1, $2) RETURNING id",
            [slug, request.principal!.id]
          );
          policyId = created.rows[0]!.id;
          await appendAuditEvent(client, {
            actor,
            type: "policy.created",
            entity: { type: "policy", id: policyId },
            payload: { slug },
          });
        }
        const maxVersion = await client.query<{ max: number | null }>(
          "SELECT max(version) AS max FROM policy_versions WHERE policy_id = $1",
          [policyId]
        );
        const version = (maxVersion.rows[0]?.max ?? 0) + 1;
        const inserted = await client.query<{
          id: string;
          policy_id: string;
          version: number;
          status: "draft" | "active" | "retired";
          content_hash: string;
          simulation_run_id: string | null;
          activation_override_reason: string | null;
          created_at: Date;
          activated_at: Date | null;
        }>(
          `INSERT INTO policy_versions
             (policy_id, version, status, source_yaml, canonical_json, content_hash, created_by)
           VALUES ($1, $2, 'draft', $3, $4, $5, $6) RETURNING *`,
          [
            policyId,
            version,
            sourceYaml,
            canonicalize(compiled.document as unknown as JsonValue),
            compiled.contentHash,
            request.principal!.id,
          ]
        );
        await appendAuditEvent(client, {
          actor,
          type: "policy_version.drafted",
          entity: { type: "policy_version", id: inserted.rows[0]!.id },
          payload: { slug, version, contentHash: compiled.contentHash },
        });
        return versionRowOut(inserted.rows[0]!);
      });
    }
  );

  app.get(
    "/policies/:slug/versions",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ slug: z.string() }),
        response: { 200: z.array(VersionOut) },
      },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const rows = await ctx.pool.query<Parameters<typeof versionRowOut>[0]>(
        `SELECT v.* FROM policy_versions v
         JOIN policies p ON p.id = v.policy_id
         WHERE p.slug = $1 ORDER BY v.version`,
        [request.params.slug]
      );
      return rows.rows.map(versionRowOut);
    }
  );

  app.get(
    "/policy-versions/:id",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: VersionOut.extend({
            sourceYaml: z.string(),
            findings: z.array(LintFindingOut),
          }),
        },
      },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const rows = await ctx.pool.query<
        Parameters<typeof versionRowOut>[0] & { source_yaml: string; canonical_json: unknown }
      >("SELECT * FROM policy_versions WHERE id = $1", [request.params.id]);
      const row = rows.rows[0];
      if (!row) throw new ApiError("not_found", "policy version not found");
      const findings = lintPolicy(row.canonical_json as RiskPolicyV1);
      return { ...versionRowOut(row), sourceYaml: row.source_yaml, findings };
    }
  );

  app.get(
    "/policy-versions/:id/diff/:otherId",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ id: z.string().uuid(), otherId: z.string().uuid() }),
        response: {
          200: z.object({
            changes: z.array(
              z.object({ path: z.string(), change: z.enum(["added", "removed", "changed"]) })
            ),
          }),
        },
      },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const rows = await ctx.pool.query<{ id: string; canonical_json: unknown }>(
        "SELECT id, canonical_json FROM policy_versions WHERE id = ANY($1::uuid[])",
        [[request.params.id, request.params.otherId]]
      );
      const a = rows.rows.find((r) => r.id === request.params.id);
      const b = rows.rows.find((r) => r.id === request.params.otherId);
      if (!a || !b) throw new ApiError("not_found", "policy version not found");
      return {
        changes: policyDiff(a.canonical_json as RiskPolicyV1, b.canonical_json as RiskPolicyV1),
      };
    }
  );

  app.post(
    "/policy-versions/:id/activate",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            simulationRunId: z.string().uuid().optional(),
            overrideReason: z.string().min(10).optional(),
          })
          .refine((b) => (b.simulationRunId ? !b.overrideReason : !!b.overrideReason), {
            message: "provide exactly one of simulationRunId or overrideReason",
          }),
        response: { 200: VersionOut },
      },
      preHandler: [app.requireRole("policy_author")],
    },
    async (request) => {
      const { id } = request.params;
      const { simulationRunId, overrideReason } = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };

      return withTx(ctx.pool, async (client) => {
        const row = await client.query<{
          id: string;
          policy_id: string;
          status: string;
          content_hash: string;
        }>(
          "SELECT id, policy_id, status, content_hash FROM policy_versions WHERE id = $1 FOR UPDATE",
          [id]
        );
        const version = row.rows[0];
        if (!version) throw new ApiError("not_found", "policy version not found");
        if (version.status !== "draft") {
          throw new ApiError("state_conflict", `cannot activate a ${version.status} version`);
        }
        if (simulationRunId) {
          const run = await client.query<{
            status: string;
            candidate_content_hash: string;
            baseline_policy_version_id: string;
          }>(
            "SELECT status, candidate_content_hash, baseline_policy_version_id FROM simulation_runs WHERE id = $1",
            [simulationRunId]
          );
          if (!run.rows[0]) throw new ApiError("not_found", "simulation run not found");
          if (run.rows[0].status !== "done") {
            throw new ApiError("state_conflict", "simulation run has not completed");
          }
          // The run must have tested THIS candidate (byte-identical) against a
          // baseline of the SAME policy — not an unrelated or stale run.
          if (run.rows[0].candidate_content_hash !== version.content_hash) {
            throw new ApiError(
              "state_conflict",
              "the simulation run tested a different candidate than this version — re-run the simulation"
            );
          }
          const baseline = await client.query<{ policy_id: string }>(
            "SELECT policy_id FROM policy_versions WHERE id = $1",
            [run.rows[0].baseline_policy_version_id]
          );
          if (baseline.rows[0]?.policy_id !== version.policy_id) {
            throw new ApiError(
              "state_conflict",
              "the simulation run was against a different policy"
            );
          }
        }
        // Retire the current active version, if any.
        const active = await client.query<{ id: string }>(
          "SELECT id FROM policy_versions WHERE policy_id = $1 AND status = 'active' FOR UPDATE",
          [version.policy_id]
        );
        if (active.rows[0]) {
          await client.query(
            "UPDATE policy_versions SET status = 'retired', retired_at = now() WHERE id = $1",
            [active.rows[0].id]
          );
          await appendAuditEvent(client, {
            actor,
            type: "policy_version.retired",
            entity: { type: "policy_version", id: active.rows[0].id },
            payload: { supersededBy: id },
          });
        }
        const updated = await client.query<Parameters<typeof versionRowOut>[0]>(
          `UPDATE policy_versions
           SET status = 'active', activated_at = now(),
               simulation_run_id = $2, activation_override_reason = $3
           WHERE id = $1 RETURNING *`,
          [id, simulationRunId ?? null, overrideReason ?? null]
        );
        await appendAuditEvent(client, {
          actor,
          type: "policy_version.activated",
          entity: { type: "policy_version", id },
          payload: {
            simulationRunId: simulationRunId ?? null,
            overrideReason: overrideReason ?? null,
          },
        });
        return versionRowOut(updated.rows[0]!);
      });
    }
  );

  app.post(
    "/policy-versions/:id/retire",
    {
      schema: {
        tags: ["policies"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: VersionOut },
      },
      preHandler: [app.requireRole("policy_author")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const updated = await client.query<Parameters<typeof versionRowOut>[0]>(
          `UPDATE policy_versions SET status = 'retired', retired_at = now()
           WHERE id = $1 AND status = 'active' RETURNING *`,
          [request.params.id]
        );
        if (!updated.rows[0]) {
          throw new ApiError("state_conflict", "only an active version can be retired");
        }
        await appendAuditEvent(client, {
          actor,
          type: "policy_version.retired",
          entity: { type: "policy_version", id: request.params.id },
          payload: {},
        });
        return versionRowOut(updated.rows[0]);
      });
    }
  );
}
