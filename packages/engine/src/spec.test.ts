/**
 * Phase 0 executable spec: the canonical derivation example from ADR 0004
 * must validate against the contract schemas, and the unimplemented core
 * must say so honestly.
 */
import { describe, expect, it } from "vitest";
import { classify, ENGINE_VERSION } from "./classify.js";
import { ClassificationResult, Derivation, Fact } from "./types.js";

const canonicalDerivation = {
  engineVersion: ENGINE_VERSION,
  policy: { id: "starter-balanced", version: 1, contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
  subject: {
    initiatorKind: "agent" as const,
    initiator: "agent:procure-bot-3",
    onBehalfOf: "user:j.doe",
    actionType: "vendor_contract",
  },
  documents: [{ name: "msa_draft_v4.pdf", sha256: "0000000000000000000000000000000000000000000000000000000000000000" }],
  factSet: {
    facts: [
      {
        id: "amount_base_total",
        status: "FOUND" as const,
        value: 4200000,
        unit: "EUR",
        confidence: 0.97,
        citation: { docIndex: 0, span: [1204, 1262] as [number, number], text: "aggregate fees of EUR 4,200,000 over the Term" },
      },
      { id: "liability_cap_exists", status: "NOT_FOUND" as const },
    ],
    extraction: { model: "example-extractor", promptHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
  },
  categoryEvaluations: [
    {
      category: "financial",
      handling: "scored" as const,
      impactBand: "Severe",
      bandRuleFired: "else",
      likelihoodBand: "Unlikely",
      likelihoodRulesFired: ["default"],
      matrixRating: "High",
      appetiteRowApplied: "agent_initiated" as const,
      requiredTier: 4,
      appetiteBreached: true,
      distanceFromNextBoundary: { bands: 1, direction: "above" as const },
    },
    {
      category: "reversibility",
      handling: "escalated_conservative" as const,
      impactBand: "Locked_in",
      matrixRating: "High",
      requiredTier: 2,
      missingFacts: ["termination_for_convenience", "contract_term_months"],
    },
  ],
  composition: {
    baseTier: { tier: 4, bindingCategory: "financial" },
    triggers: [
      { id: "sanctions_exposure", fired: false, minTier: 4 },
      { id: "uncapped_liability", fired: true, tierUplift: 1 },
      { id: "novel_precedent", fired: false, tierUplift: 1 },
    ],
    accumulation: { countAtOrAbove: "High", observedCount: 2, threshold: 3, applied: false },
    agentUplift: { appliedVia: "appetite_agent_initiated" as const, selfApproveFloorApplied: false },
    finalTier: 4,
  },
  explanation:
    "Routed to Board because the EUR 4,200,000 aggregate exposure falls in your 'Severe' financial impact band; under your agent-initiated appetite, High financial risk requires Board approval. No liability cap was found; reversibility was conservatively assessed at 'Locked_in' per your missing-information policy.",
};

describe("derivation contract", () => {
  it("accepts the canonical ADR-0004 example", () => {
    expect(() => Derivation.parse(canonicalDerivation)).not.toThrow();
  });

  it("accepts a ROUTED result wrapping it", () => {
    const result = ClassificationResult.parse({
      status: "ROUTED",
      tier: 4,
      tierName: "Board",
      derivation: canonicalDerivation,
    });
    expect(result.status).toBe("ROUTED");
  });

  it("records triggers tested-but-not-fired, not only fired ones", () => {
    const parsed = Derivation.parse(canonicalDerivation);
    const tested = parsed.composition?.triggers ?? [];
    expect(tested.some((t) => !t.fired)).toBe(true);
  });
});

describe("fact contract", () => {
  it("rejects a FOUND fact without a citation — extraction must cite or abstain", () => {
    expect(() =>
      Fact.parse({ id: "amount_base_total", status: "FOUND", value: 100 })
    ).toThrow();
  });

  it("rejects a NOT_FOUND fact carrying a value — absence is absence", () => {
    expect(() =>
      Fact.parse({ id: "liability_cap_exists", status: "NOT_FOUND", value: false })
    ).toThrow();
  });
});

describe("classify (Phase 1 pending)", () => {
  it("is honestly unimplemented", () => {
    expect(() =>
      classify({
        factSet: { facts: [] },
        policy: { policyId: "x", version: 1, contentHash: "sha256:0", document: {} as never },
        subject: { initiatorKind: "human", initiator: "user:someone" },
        documents: [],
      })
    ).toThrow(/Not implemented/);
  });
});
