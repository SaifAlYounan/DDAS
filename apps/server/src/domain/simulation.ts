/**
 * Simulation = pure engine replay of STORED fact sets under a candidate
 * policy. It never calls the LLM — facts are stored separately from
 * classifications precisely so backtesting is free and exact.
 */
import { appendAuditEvent } from "@ddas/audit";
import { classify, type Subject } from "@ddas/engine";
import { compileDocument, compilePolicy } from "@ddas/policy";
import type pg from "pg";
import { factSetFromRows, type FactRow } from "./classification.js";
import { withTx } from "./tx.js";

interface Replayed {
  status: "ROUTED" | "INCOMPLETE";
  tier: number | null;
  tierName: string | null;
  missingFacts?: unknown;
}

export interface SimulationSummary {
  factSets: number;
  changed: number;
  newlyIncomplete: number;
  tierShifts: Array<{ from: number | null; to: number | null; count: number }>;
}

export async function runSimulation(pool: pg.Pool, runId: string): Promise<void> {
  await pool.query(
    "UPDATE simulation_runs SET status = 'running' WHERE id = $1 AND status = 'pending'",
    [runId]
  );
  try {
    await withTx(pool, async (client) => {
      const runs = await client.query<{
        id: string;
        baseline_policy_version_id: string;
        candidate_source_yaml: string;
      }>("SELECT * FROM simulation_runs WHERE id = $1", [runId]);
      const run = runs.rows[0];
      if (!run) throw new Error(`simulation run ${runId} vanished`);

      const baselineRow = await client.query<{ canonical_json: unknown }>(
        "SELECT canonical_json FROM policy_versions WHERE id = $1",
        [run.baseline_policy_version_id]
      );
      const baseline = compileDocument(baselineRow.rows[0]!.canonical_json);
      const candidate = compilePolicy(run.candidate_source_yaml);

      // Every CONFIRMED fact set whose request ran under the baseline's policy family.
      const factSets = await client.query<{
        id: string;
        request_id: string;
        extraction_model: string | null;
        prompt_hash: string | null;
        requester_id: string;
        requester_kind: "human" | "agent";
        owner_principal_id: string | null;
      }>(
        `SELECT fs.id, fs.request_id, fs.extraction_model, fs.prompt_hash,
                r.requester_id, p.kind AS requester_kind, p.owner_principal_id
         FROM fact_sets fs
         JOIN requests r ON r.id = fs.request_id
         JOIN principals p ON p.id = r.requester_id
         WHERE fs.status = 'confirmed'
         ORDER BY fs.created_at`
      );

      let changed = 0;
      let newlyIncomplete = 0;
      const shifts = new Map<string, { from: number | null; to: number | null; count: number }>();

      for (const factSet of factSets.rows) {
        const factRows = await client.query<FactRow>(
          `SELECT fact_id, status, value, unit, confidence, citation_doc_index,
                  citation_start, citation_end, citation_text, attested_by
           FROM facts WHERE fact_set_id = $1 ORDER BY fact_id`,
          [factSet.id]
        );
        const documents = await client.query<{ name: string; sha256: string }>(
          "SELECT name, sha256 FROM documents WHERE request_id = $1 ORDER BY doc_index",
          [factSet.request_id]
        );
        const engineFactSet = factSetFromRows(factRows.rows, {
          model: factSet.extraction_model,
          promptHash: factSet.prompt_hash,
        });
        const subject: Subject = {
          initiatorKind: factSet.requester_kind,
          initiator: factSet.requester_id,
          ...(factSet.requester_kind === "agent" && factSet.owner_principal_id
            ? { onBehalfOf: factSet.owner_principal_id }
            : {}),
        };
        const docs = documents.rows.map((d) => ({ name: d.name, sha256: d.sha256 }));

        const replay = (policy: typeof baseline): Replayed => {
          const result = classify({ factSet: engineFactSet, policy, subject, documents: docs });
          return result.status === "ROUTED"
            ? { status: "ROUTED", tier: result.tier, tierName: result.tierName }
            : { status: "INCOMPLETE", tier: null, tierName: null, missingFacts: result.missingFacts };
        };
        const base = replay(baseline);
        const cand = replay(candidate);
        const isChanged = base.status !== cand.status || base.tier !== cand.tier;
        if (isChanged) changed += 1;
        if (base.status === "ROUTED" && cand.status === "INCOMPLETE") newlyIncomplete += 1;
        const key = `${base.tier}→${cand.tier}`;
        const entry = shifts.get(key) ?? { from: base.tier, to: cand.tier, count: 0 };
        entry.count += 1;
        shifts.set(key, entry);

        await client.query(
          `INSERT INTO simulation_results (run_id, request_id, fact_set_id, baseline, candidate, changed)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id, request_id) DO NOTHING`,
          [runId, factSet.request_id, factSet.id, JSON.stringify(base), JSON.stringify(cand), isChanged]
        );
      }

      const summary: SimulationSummary = {
        factSets: factSets.rows.length,
        changed,
        newlyIncomplete,
        tierShifts: [...shifts.values()].sort((a, b) => b.count - a.count),
      };
      await client.query(
        "UPDATE simulation_runs SET status = 'done', summary = $2, finished_at = now() WHERE id = $1",
        [runId, JSON.stringify(summary)]
      );
      await appendAuditEvent(client, {
        actor: { kind: "system" },
        type: "simulation.completed",
        entity: { type: "simulation_run", id: runId },
        payload: summary as unknown as Record<string, unknown>,
      });
    });
  } catch (err) {
    await withTx(pool, async (client) => {
      await client.query(
        "UPDATE simulation_runs SET status = 'failed', summary = $2, finished_at = now() WHERE id = $1",
        [runId, JSON.stringify({ error: String(err) })]
      );
      await appendAuditEvent(client, {
        actor: { kind: "system" },
        type: "simulation.failed",
        entity: { type: "simulation_run", id: runId },
        payload: { error: String(err) },
      });
    });
    throw err;
  }
}
