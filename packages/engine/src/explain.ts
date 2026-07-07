/**
 * Explanation templating — deterministic string assembly from the derivation
 * only, fixed clause order. NEVER LLM-generated (ADR 0003): the explanation
 * cannot diverge from the computation because it is a projection of it.
 */
import type { CompiledIndices } from "@ddas/policy";
import type { CategoryEvaluation, Composition } from "./types.js";

export function explainRouted(
  compiled: CompiledIndices,
  evals: CategoryEvaluation[],
  composition: Composition,
  flags: { missingInfoFloorApplied: boolean }
): string {
  const tierName = (t: number) => compiled.ladder[Math.min(t, compiled.maxTier)]!.name;
  const catName = (id: string) => compiled.categories.find((c) => c.id === id)?.name ?? id;
  const clauses: string[] = [];

  const binding = evals.find((e) => e.category === composition.baseTier.bindingCategory);
  if (binding && binding.handling !== "needs_info") {
    const agentRow = binding.appetiteRowApplied === "agent_initiated";
    clauses.push(
      `Routed to ${tierName(composition.finalTier)}: ${catName(binding.category)} was assessed ` +
        `'${binding.impactBand}' impact × '${binding.likelihoodBand}' likelihood → '${binding.matrixRating}', ` +
        `which your ${agentRow ? "agent-initiated " : ""}appetite maps to ${tierName(binding.requiredTier ?? 0)}.`
    );
  }
  for (const e of evals) {
    if (e.handling === "escalated_conservative") {
      clauses.push(
        `${catName(e.category)} was conservatively assessed at '${e.impactBand}' per your ` +
          `missing-information policy (${(e.missingFacts ?? []).join(", ")} not found).`
      );
    }
  }
  for (const t of composition.triggers) {
    if (!t.fired) continue;
    const rationale = compiled.triggers.find((ct) => ct.id === t.id)?.rationale ?? "";
    clauses.push(`Trigger '${t.id}': ${rationale}`);
  }
  if (composition.accumulation?.applied) {
    clauses.push(
      `${composition.accumulation.observedCount} categories rated at or above ` +
        `'${composition.accumulation.countAtOrAbove}' (threshold ${composition.accumulation.threshold}); one tier added.`
    );
  }
  if (composition.agentUplift?.selfApproveFloorApplied) {
    clauses.push(`Agent-initiated actions may not self-approve; routed to ${tierName(1)}.`);
  }
  if (flags.missingInfoFloorApplied) {
    clauses.push(`Missing information never resolves to self-approval; routed to ${tierName(composition.finalTier)}.`);
  }
  return clauses.join(" ");
}

export function explainIncomplete(
  compiled: CompiledIndices,
  missing: Array<{ category: string; facts: string[] }>
): string {
  const catName = (id: string) =>
    id === "agent_policy" ? "agent attestation" : compiled.categories.find((c) => c.id === id)?.name ?? id;
  const parts = missing.map((m) => `${catName(m.category)} needs ${m.facts.join(", ")}`);
  return `Cannot classify — missing required information: ${parts.join("; ")}. No routing performed.`;
}
