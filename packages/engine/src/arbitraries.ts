/**
 * fast-check generators for the property suite.
 *
 * Policies are valid BY CONSTRUCTION — each lint invariant has a constructive
 * generator (sorted thresholds ⇒ ordered exhaustive bands; matrix cell =
 * max(left, up) + Bernoulli increment ⇒ monotone both axes; sorted appetite
 * draws ⇒ monotone appetites). properties.test.ts then asserts lintPolicy is
 * clean on every generated policy, which cross-tests the linter itself.
 *
 * Fact sets are generated CONFORMANT to the generated policy's fact schema.
 */
import fc from "fast-check";
import type { RiskPolicyV1 } from "@ddas/policy";
import type { Fact, FactSet, Subject } from "./types.js";

export interface GeneratedCase {
  doc: RiskPolicyV1;
  factSet: FactSet;
  subject: Subject;
}

const BAD_LIST = ["J_BAD_0", "J_BAD_1"];
const OK_JURIS = ["J_OK_0", "J_OK_1"];

/** Sorted, strictly increasing positive thresholds. */
const thresholdsArb = fc
  .array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 3 })
  .map((xs) => [...new Set(xs)].sort((a, b) => a - b));

interface CatShape {
  thresholds: number[];
  hasLikRule: boolean;
  likMinBandPick: number; // scaled into range later
  defaultBandPick: number;
  matrixSeed: number[]; // Bernoulli increments, consumed cell by cell
  appetitePicks: number[]; // raw draws, sorted + scaled later
  agentColumn: boolean;
  agentIncrements: number[];
  missingBehavior: "escalate" | "needs_info";
  conservativePick: number;
  requireFact: boolean;
}

const catShapeArb: fc.Arbitrary<CatShape> = fc.record({
  thresholds: thresholdsArb,
  hasLikRule: fc.boolean(),
  likMinBandPick: fc.nat(100),
  defaultBandPick: fc.nat(100),
  matrixSeed: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 30, maxLength: 30 }),
  appetitePicks: fc.array(fc.nat(100), { minLength: 6, maxLength: 6 }),
  agentColumn: fc.boolean(),
  agentIncrements: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 6, maxLength: 6 }),
  missingBehavior: fc.constantFrom("escalate", "needs_info"),
  conservativePick: fc.nat(100),
  requireFact: fc.boolean(),
});

export interface PolicyShape {
  nTiers: number;
  nLik: number;
  nRat: number;
  cats: CatShape[];
  trigger: { enabled: boolean; kind: "min_tier" | "tier_uplift"; tierPick: number };
  accumulation: { enabled: boolean; ratingPick: number; threshold: number };
  agent: { defaultUplift: number; selfApproveAllowed: boolean; attestation: boolean };
}

export const policyShapeArb: fc.Arbitrary<PolicyShape> = fc.record({
  nTiers: fc.integer({ min: 2, max: 5 }),
  nLik: fc.integer({ min: 2, max: 5 }),
  nRat: fc.integer({ min: 2, max: 5 }),
  cats: fc.array(catShapeArb, { minLength: 1, maxLength: 4 }),
  trigger: fc.record({
    enabled: fc.boolean(),
    kind: fc.constantFrom("min_tier", "tier_uplift"),
    tierPick: fc.nat(100),
  }),
  accumulation: fc.record({
    enabled: fc.boolean(),
    ratingPick: fc.nat(100),
    threshold: fc.integer({ min: 2, max: 5 }),
  }),
  agent: fc.record({
    defaultUplift: fc.integer({ min: 0, max: 2 }),
    selfApproveAllowed: fc.boolean(),
    attestation: fc.boolean(),
  }),
});

export function buildPolicy(shape: PolicyShape): RiskPolicyV1 {
  const maxTier = shape.nTiers - 1;
  const likBands = Array.from({ length: shape.nLik }, (_, i) => `lb${i}`);
  const ratings = Array.from({ length: shape.nRat }, (_, i) => `r${i}`);
  const pick = <T>(xs: T[], seed: number): T => xs[seed % xs.length]!;

  const factSchema: RiskPolicyV1["fact_schema"] = [
    { id: "juris", type: "string", description: "jurisdiction" },
  ];
  const categories: RiskPolicyV1["categories"] = shape.cats.map((c, ci) => {
    const amountId = `amount_c${ci}`;
    const flagId = `flag_c${ci}`;
    factSchema.push({ id: amountId, type: "number" });
    if (c.hasLikRule) factSchema.push({ id: flagId, type: "boolean" });

    const bandNames = [...c.thresholds.map((_, i) => `b${i}`), `b${c.thresholds.length}`];
    const bands = [
      ...c.thresholds.map((t, i) => ({ name: bandNames[i]!, rule: `${amountId} < ${t}` })),
      { name: bandNames.at(-1)!, rule: "else" },
    ];

    // monotone matrix by construction: cell = max(left, up) + increment, clamped
    const matrix: Record<string, string[]> = {};
    let seedIdx = 0;
    let prevRow: number[] | null = null;
    for (const band of bandNames) {
      const row: number[] = [];
      for (let li = 0; li < shape.nLik; li++) {
        const left = li > 0 ? row[li - 1]! : 0;
        const up = prevRow ? prevRow[li]! : 0;
        const inc = c.matrixSeed[seedIdx++ % c.matrixSeed.length]! === 0 ? 1 : 0;
        row.push(Math.min(Math.max(left, up) + inc, shape.nRat - 1));
      }
      matrix[band] = row.map((r) => ratings[r]!);
      prevRow = row;
    }

    // monotone appetite: sorted draws scaled into [0, maxTier]
    const appetite: Record<string, number> = {};
    const draws = c.appetitePicks
      .slice(0, shape.nRat)
      .map((p) => p % (maxTier + 1))
      .sort((a, b) => a - b);
    ratings.forEach((r, i) => (appetite[r] = draws[i] ?? draws.at(-1) ?? 0));

    let agentAppetite: Record<string, number> | undefined;
    if (c.agentColumn) {
      agentAppetite = {};
      let runningMax = 0; // running max keeps the column monotone AND >= the (monotone) default
      ratings.forEach((r, i) => {
        const v = Math.min(appetite[r]! + (c.agentIncrements[i] ?? 0), maxTier);
        runningMax = Math.max(runningMax, v);
        agentAppetite![r] = runningMax;
      });
    }

    return {
      id: `cat${ci}`,
      impact_scale: {
        bands,
        required_facts: c.requireFact ? [amountId] : [],
      },
      likelihood_rules: [
        ...(c.hasLikRule ? [{ if: `${flagId} == true`, min_band: pick(likBands, c.likMinBandPick) }] : []),
        { default_band: pick(likBands, c.defaultBandPick) },
      ],
      risk_matrix: matrix,
      appetite,
      ...(agentAppetite ? { appetite_agent_initiated: agentAppetite } : {}),
      missing_info:
        c.missingBehavior === "escalate"
          ? { behavior: "escalate" as const, conservative_band: pick(bandNames, c.conservativePick) }
          : { behavior: "needs_info" as const },
    };
  });

  return {
    schema_version: 1,
    policy_id: "generated",
    name: "Generated policy",
    version: 1,
    effective_from: "2026-01-01",
    authority_ladder: Array.from({ length: shape.nTiers }, (_, i) => ({ tier: i, name: `T${i}` })),
    likelihood_scale: { bands: likBands },
    rating_scale: { ratings },
    fact_schema: factSchema,
    categories,
    ...(shape.trigger.enabled
      ? {
          escalation_triggers: [
            {
              id: "trig_sanctions",
              rule: "juris in bad_list",
              rationale: "Generated trigger.",
              ...(shape.trigger.kind === "min_tier"
                ? { min_tier: Math.max(1, shape.trigger.tierPick % (maxTier + 1)) }
                : { tier_uplift: 1 }),
            },
          ],
        }
      : {}),
    ...(shape.accumulation.enabled
      ? {
          accumulation_rule: {
            count_at_or_above: ratings[shape.accumulation.ratingPick % ratings.length]!,
            threshold: shape.accumulation.threshold,
            tier_uplift: 1,
          },
        }
      : {}),
    agent_policy: {
      default_uplift: shape.agent.defaultUplift,
      self_approve_allowed: shape.agent.selfApproveAllowed,
      ...(shape.agent.attestation ? { attestation_required_facts: ["juris"] } : {}),
    },
    reference_lists: { bad_list: BAD_LIST },
  };
}

// ---------- conformant fact sets ----------

type FactChoice = { kind: "found"; pick: number } | { kind: "not_found" } | { kind: "absent" };

const factChoiceArb: fc.Arbitrary<FactChoice> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("found" as const), pick: fc.nat(2_000_000) }) },
  { weight: 2, arbitrary: fc.constant({ kind: "not_found" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "absent" as const }) }
);

export const factChoicesArb = fc.array(factChoiceArb, { minLength: 20, maxLength: 20 });

export function buildFactSet(doc: RiskPolicyV1, choices: FactChoice[], attestJuris: boolean): FactSet {
  const facts: Fact[] = [];
  doc.fact_schema.forEach((decl, i) => {
    const choice = choices[i % choices.length]!;
    if (choice.kind === "absent") return;
    if (choice.kind === "not_found") {
      facts.push({ id: decl.id, status: "NOT_FOUND" } as Fact);
      return;
    }
    let value: Fact["value"];
    switch (decl.type) {
      case "number":
        value = choice.pick;
        break;
      case "boolean":
        value = choice.pick % 2 === 0;
        break;
      case "string":
        value = [...BAD_LIST, ...OK_JURIS][choice.pick % 4]!;
        break;
      default:
        value = choice.pick;
    }
    if (decl.id === "juris" && attestJuris) {
      facts.push({ id: decl.id, status: "MANUAL", value, attestedBy: "user:owner" } as Fact);
    } else {
      facts.push({
        id: decl.id,
        status: "FOUND",
        value,
        citation: { docIndex: 0, span: [0, 5], text: "cited" },
      } as Fact);
    }
  });
  return { facts };
}

export const subjectArb: fc.Arbitrary<Subject> = fc.oneof(
  fc.constant<Subject>({ initiatorKind: "human", initiator: "user:gen" }),
  fc.constant<Subject>({ initiatorKind: "agent", initiator: "agent:gen", onBehalfOf: "user:gen" })
);

export const caseArb: fc.Arbitrary<GeneratedCase> = fc
  .record({
    shape: policyShapeArb,
    choices: factChoicesArb,
    subject: subjectArb,
    attest: fc.boolean(),
  })
  .map(({ shape, choices, subject, attest }) => {
    const doc = buildPolicy(shape);
    return { doc, factSet: buildFactSet(doc, choices, attest), subject };
  });
