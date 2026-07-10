import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import { compilePolicy, PolicyCompileError } from "@ddas/policy";
import type { App, AppContext } from "../app.js";
import { runSimulation } from "../domain/simulation.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

export function registerSimulationRoutes(app: App, ctx: AppContext): void {
  app.post(
    "/simulations",
    {
      schema: {
        tags: ["simulations"],
        body: z.object({
          baselinePolicyVersionId: z.string().uuid(),
          candidateYaml: z.string().min(1),
        }),
        response: { 200: z.object({ id: z.string(), status: z.string() }) },
      },
      preHandler: [app.requirePermission("simulations.run")],
    },
    async (request) => {
      const { baselinePolicyVersionId, candidateYaml } = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };

      let candidate;
      try {
        candidate = compilePolicy(candidateYaml);
      } catch (err) {
        if (err instanceof PolicyCompileError) {
          throw new ApiError("validation_failed", "candidate policy failed lint", {
            findings: err.findings,
          });
        }
        throw new ApiError("validation_failed", `unparseable candidate: ${String(err)}`);
      }

      const baseline = await ctx.pool.query(
        "SELECT id FROM policy_versions WHERE id = $1",
        [baselinePolicyVersionId]
      );
      if (!baseline.rows[0]) throw new ApiError("not_found", "baseline policy version not found");

      const runId = await withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO simulation_runs
             (baseline_policy_version_id, candidate_source_yaml, candidate_content_hash, status, created_by)
           VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
          [baselinePolicyVersionId, candidateYaml, candidate.contentHash, request.principal!.id]
        );
        await appendAuditEvent(client, {
          actor,
          type: "simulation.started",
          entity: { type: "simulation_run", id: inserted.rows[0]!.id },
          payload: { baselinePolicyVersionId, candidateContentHash: candidate.contentHash },
        });
        return inserted.rows[0]!.id;
      });

      if (ctx.boss) {
        await ctx.boss.send("simulation.run", { runId });
      } else {
        // Route-only test mode: run inline (the simulation is pure + fast).
        await runSimulation(ctx.pool, runId);
      }
      return { id: runId, status: "pending" };
    }
  );

  app.get(
    "/simulations/:id",
    {
      schema: {
        tags: ["simulations"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            id: z.string(),
            status: z.enum(["pending", "running", "done", "failed"]),
            baselinePolicyVersionId: z.string(),
            candidateContentHash: z.string(),
            summary: z.unknown().nullable(),
            createdAt: z.string(),
            finishedAt: z.string().nullable(),
            results: z.array(
              z.object({
                requestId: z.string(),
                factSetId: z.string(),
                changed: z.boolean(),
                baseline: z.unknown(),
                candidate: z.unknown(),
              })
            ),
          }),
        },
      },
      preHandler: [app.requireAuth],
    },
    async (request) => {
      const runs = await ctx.pool.query<{
        id: string;
        status: "pending" | "running" | "done" | "failed";
        baseline_policy_version_id: string;
        candidate_content_hash: string;
        summary: unknown;
        created_at: Date;
        finished_at: Date | null;
      }>("SELECT * FROM simulation_runs WHERE id = $1", [request.params.id]);
      const run = runs.rows[0];
      if (!run) throw new ApiError("not_found", "simulation run not found");
      const results = await ctx.pool.query<{
        request_id: string;
        fact_set_id: string;
        changed: boolean;
        baseline: unknown;
        candidate: unknown;
      }>(
        "SELECT request_id, fact_set_id, changed, baseline, candidate FROM simulation_results WHERE run_id = $1",
        [run.id]
      );
      return {
        id: run.id,
        status: run.status,
        baselinePolicyVersionId: run.baseline_policy_version_id,
        candidateContentHash: run.candidate_content_hash,
        summary: run.summary,
        createdAt: run.created_at.toISOString(),
        finishedAt: run.finished_at?.toISOString() ?? null,
        results: results.rows.map((r) => ({
          requestId: r.request_id,
          factSetId: r.fact_set_id,
          changed: r.changed,
          baseline: r.baseline,
          candidate: r.candidate,
        })),
      };
    }
  );
}
