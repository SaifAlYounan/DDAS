/**
 * The DDAS classification core: Appetite-Constrained Ordinal Sorting (ACOS).
 * See docs/adr/0004-acos-risk-model.md.
 *
 * PURITY CONTRACT — this module is a pure function of its inputs:
 * no I/O, no clock, no environment, no randomness. The engine operates on
 * integer band indices only: comparisons, lookups, max, and counting.
 * It never performs arithmetic on risk values.
 *
 * INVARIANTS (property-tested; a PR weakening any needs an ADR):
 *  - Determinism: same (factSet, policy, subject) → byte-identical derivation.
 *  - Monotonicity: worsening any fact, raising any likelihood band, adding a
 *    trigger condition, or switching initiator human→agent never lowers the tier.
 *  - Unknown-dominance: a NOT_FOUND required fact never yields a lower tier
 *    than any known value below the conservative band, and never Self-approve.
 *  - Upward-only composition: nothing after the base-tier max lowers the tier.
 *  - Totality: any schema-valid input returns a result, never throws.
 */
import type { CompiledPolicy } from "@ddas/policy";
import { evalRule, type EvalContext } from "./evalRule.js";
import { explainIncomplete, explainRouted } from "./explain.js";
import { resolveFacts } from "./resolve.js";
import {
  FactSet as FactSetSchema,
  Subject as SubjectSchema,
  type CategoryEvaluation,
  type ClassificationResult,
  type Composition,
  type FactSet,
  type Subject,
  type TriggerOutcome,
} from "./types.js";

export const ENGINE_VERSION = "2.0.0";

export interface ClassifyInput {
  factSet: FactSet;
  policy: CompiledPolicy;
  subject: Subject;
  documents: Array<{ name: string; sha256: string }>;
}

/** Thrown only on schema-INVALID input; totality holds over schema-valid inputs. */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInputError";
  }
}

export function classify(input: ClassifyInput): ClassificationResult {
  const factsParsed = FactSetSchema.safeParse(input.factSet);
  const subjectParsed = SubjectSchema.safeParse(input.subject);
  if (!factsParsed.success) throw new EngineInputError(`invalid factSet: ${factsParsed.error.message}`);
  if (!subjectParsed.success) throw new EngineInputError(`invalid subject: ${subjectParsed.error.message}`);
  const factSet = factsParsed.data;
  const subject = subjectParsed.data;
  const { compiled } = input.policy;
  const isAgent = subject.initiatorKind === "agent";

  // Stage 0 — resolve facts once; precompile list sets.
  const ctx: EvalContext = {
    resolved: resolveFacts(factSet, compiled),
    listSets: compiled.referenceLists.map((l) => new Set(l)),
  };

  // Stage 1–3 — per-category evaluation (ALL categories, always).
  const evals: CategoryEvaluation[] = [];
  const catRatingIdx: Array<number | null> = []; // parallel; null for needs_info
  const missing: Array<{ category: string; facts: string[] }> = [];

  for (const cat of compiled.categories) {
    const missingFacts = cat.requiredFactIdxs
      .filter((i) => ctx.resolved[i] === undefined)
      .map((i) => compiled.factTable[i]!.id);

    if (missingFacts.length > 0 && cat.missingInfo.behavior === "needs_info") {
      evals.push({ category: cat.id, handling: "needs_info", missingFacts });
      catRatingIdx.push(null);
      missing.push({ category: cat.id, facts: missingFacts });
      continue;
    }

    let impactIdx: number;
    let bandRuleFired: string | undefined;
    let handling: CategoryEvaluation["handling"];
    if (missingFacts.length > 0) {
      // escalate: conservative band, then the normal (monotone) pipeline.
      impactIdx = (cat.missingInfo as { conservativeBandIdx: number }).conservativeBandIdx;
      handling = "escalated_conservative";
    } else {
      handling = "scored";
      impactIdx = cat.bands.length - 1; // totality backstop; `else` always matches anyway
      for (let bi = 0; bi < cat.bands.length; bi++) {
        if (evalRule(cat.bands[bi]!.ast, ctx) === "T") {
          impactIdx = bi;
          bandRuleFired = cat.bands[bi]!.ruleSource;
          break;
        }
      }
      bandRuleFired ??= "else";
    }

    // Likelihood: max min_band among matched (T or U) rules, else default.
    const firedSources: string[] = [];
    let matchedMax = -1;
    for (const r of cat.likelihood.rules) {
      const res = evalRule(r.ast, ctx);
      if (res === "T" || res === "U") {
        firedSources.push(r.source);
        matchedMax = Math.max(matchedMax, r.minBandIdx);
      }
    }
    const likelihoodIdx = matchedMax >= 0 ? matchedMax : cat.likelihood.defaultBandIdx;

    const ratingIdx = cat.matrix[impactIdx]![likelihoodIdx]!;

    // Appetite row (the agent-origin premium lives here, as data).
    let requiredTier: number;
    let appetiteRowApplied: "default" | "agent_initiated";
    let effectiveRow: number[];
    if (isAgent && cat.agentAppetite) {
      effectiveRow = cat.agentAppetite;
      appetiteRowApplied = "agent_initiated";
    } else if (isAgent) {
      effectiveRow = cat.appetite.map((t) => Math.min(t + compiled.agent.defaultUplift, compiled.maxTier));
      appetiteRowApplied = "default";
    } else {
      effectiveRow = cat.appetite;
      appetiteRowApplied = "default";
    }
    requiredTier = effectiveRow[ratingIdx]!;

    const distance = boundaryDistance(effectiveRow, ratingIdx);

    evals.push({
      category: cat.id,
      handling,
      impactBand: cat.bands[impactIdx]!.name,
      ...(handling === "scored" && bandRuleFired !== undefined ? { bandRuleFired } : {}),
      likelihoodBand: compiled.likelihoodBands[likelihoodIdx]!,
      likelihoodRulesFired: firedSources.length > 0 ? firedSources : ["default"],
      matrixRating: compiled.ratings[ratingIdx]!,
      appetiteRowApplied,
      requiredTier,
      appetiteBreached: requiredTier > 0,
      ...(distance ? { distanceFromNextBoundary: distance } : {}),
      ...(missingFacts.length > 0 ? { missingFacts } : {}),
    });
    catRatingIdx.push(ratingIdx);
  }

  // Agent attestation gate: required facts must be human-attested (MANUAL).
  if (isAgent && compiled.agent.attestationFactIdxs.length > 0) {
    const gaps = compiled.agent.attestationFactIdxs
      .map((i) => compiled.factTable[i]!.id)
      .filter((id) => !factSet.facts.some((f) => f.id === id && f.status === "MANUAL"));
    if (gaps.length > 0) missing.push({ category: "agent_policy", facts: gaps });
  }

  const derivationBase = {
    engineVersion: ENGINE_VERSION,
    policy: { id: input.policy.policyId, version: input.policy.version, contentHash: input.policy.contentHash },
    subject,
    documents: input.documents,
    factSet,
    categoryEvaluations: evals,
  };

  if (missing.length > 0) {
    return {
      status: "INCOMPLETE",
      missingFacts: missing,
      derivation: { ...derivationBase, explanation: explainIncomplete(compiled, missing) },
    };
  }

  // Stage 4 — composition, upward-only.
  let baseTier = 0;
  let bindingCategory = evals[0]?.category ?? "";
  for (const e of evals) {
    const t = e.requiredTier ?? 0;
    if (t > baseTier) {
      baseTier = t; // strict '>' keeps the FIRST category (policy order) attaining the max
      bindingCategory = e.category;
    }
  }
  let tier = baseTier;

  const triggers: TriggerOutcome[] = compiled.triggers.map((t) => {
    const res = evalRule(t.ast, ctx); // U = fired: unknown sanctions exposure must not route low
    return {
      id: t.id,
      fired: res === "T" || res === "U",
      ...(t.minTier !== undefined ? { minTier: t.minTier } : {}),
      ...(t.tierUplift !== undefined ? { tierUplift: t.tierUplift } : {}),
    };
  });
  for (const t of triggers) if (t.fired && t.minTier !== undefined) tier = Math.max(tier, t.minTier);
  for (const t of triggers) if (t.fired && t.tierUplift !== undefined) tier = Math.min(tier + t.tierUplift, compiled.maxTier);

  let accumulation: Composition["accumulation"];
  if (compiled.accumulation) {
    const observedCount = catRatingIdx.filter((r) => r !== null && r >= compiled.accumulation!.ratingIdx).length;
    const applied = observedCount >= compiled.accumulation.threshold;
    if (applied) tier = Math.min(tier + compiled.accumulation.tierUplift, compiled.maxTier);
    accumulation = {
      countAtOrAbove: compiled.accumulation.countAtOrAbove,
      observedCount,
      threshold: compiled.accumulation.threshold,
      applied,
    };
  }

  let agentUplift: Composition["agentUplift"];
  if (isAgent) {
    const bindingHasAgentRow = compiled.categories.find((c) => c.id === bindingCategory)?.agentAppetite !== undefined;
    let selfApproveFloorApplied = false;
    const whitelisted = subject.actionType !== undefined && compiled.agent.whitelist.includes(subject.actionType);
    if (tier === 0 && !compiled.agent.selfApproveAllowed && !whitelisted) {
      tier = 1;
      selfApproveFloorApplied = true;
    }
    agentUplift = {
      appliedVia: bindingHasAgentRow ? "appetite_agent_initiated" : compiled.agent.defaultUplift > 0 ? "default_uplift" : "none",
      selfApproveFloorApplied,
    };
  }

  // Missing-info floor: escalated categories never resolve to self-approval.
  const anyEscalated = evals.some((e) => e.handling === "escalated_conservative");
  let missingInfoFloorApplied = false;
  if (anyEscalated && tier === 0) {
    tier = 1;
    missingInfoFloorApplied = true;
  }

  const composition: Composition = {
    baseTier: { tier: baseTier, bindingCategory },
    triggers,
    ...(accumulation ? { accumulation } : {}),
    ...(agentUplift ? { agentUplift } : {}),
    finalTier: tier,
  };

  return {
    status: "ROUTED",
    tier,
    tierName: compiled.ladder[tier]!.name,
    derivation: {
      ...derivationBase,
      composition,
      explanation: explainRouted(compiled, evals, composition, { missingInfoFloorApplied }),
    },
  };
}

/**
 * Distance from the nearest appetite-tier boundary, in rating bands, on the
 * APPLIED appetite row. direction "above" = the boundary is below you (you sit
 * above it); "below" = it is above you. Tie → "below" (the safety-relevant
 * side). Flat row → undefined.
 */
function boundaryDistance(
  row: number[],
  ratingIdx: number
): { bands: number; direction: "above" | "below" } | undefined {
  const here = row[ratingIdx]!;
  let up: number | undefined;
  for (let d = 1; ratingIdx + d < row.length; d++) {
    if (row[ratingIdx + d] !== here) {
      up = d;
      break;
    }
  }
  let down: number | undefined;
  for (let d = 1; ratingIdx - d >= 0; d++) {
    if (row[ratingIdx - d] !== here) {
      down = d;
      break;
    }
  }
  if (up === undefined && down === undefined) return undefined;
  if (up !== undefined && (down === undefined || up <= down)) return { bands: up, direction: "below" };
  return { bands: down!, direction: "above" };
}
