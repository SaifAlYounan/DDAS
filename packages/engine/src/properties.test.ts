/**
 * The seven engine properties (plan §Phase 1). Policies are generated valid
 * by construction and cross-checked against the linter; facts are conformant.
 * These properties ARE the scientific claim of ADR 0003/0004 — a PR that
 * weakens one needs an ADR.
 */
import fc from "fast-check";
import { canonicalize, compileDocument, lintPolicy, type CompiledPolicy } from "@ddas/policy";
import { describe, expect, it } from "vitest";
import {
  buildFactSet,
  buildPolicy as buildPolicyFromShape,
  caseArb,
  factChoicesArb,
  policyShapeArb,
} from "./arbitraries.js";
import { classify, type ClassifyInput } from "./classify.js";
import { ClassificationResult, type Fact, type FactSet, type Subject } from "./types.js";

const DOCS = [{ name: "gen.md", sha256: "0".repeat(64) }];
const NUM_RUNS = { numRuns: 150 };

const compiledCache = new Map<string, CompiledPolicy>();
function compileCached(doc: unknown): CompiledPolicy {
  const key = canonicalize(doc as never);
  let hit = compiledCache.get(key);
  if (!hit) {
    hit = compileDocument(doc);
    compiledCache.set(key, hit);
  }
  return hit;
}

const run = (policy: CompiledPolicy, factSet: FactSet, subject: Subject) =>
  classify({ factSet, policy, subject, documents: DOCS } satisfies ClassifyInput);

/** Per-category risk posture (impact band idx, likelihood idx) + fired triggers, from a derivation. */
function posture(policy: CompiledPolicy, result: ReturnType<typeof classify>) {
  const cats = new Map<string, { impact: number; lik: number }>();
  for (const e of result.derivation.categoryEvaluations) {
    if (e.handling === "needs_info") return null; // posture undefined
    const cat = policy.compiled.categories.find((c) => c.id === e.category)!;
    cats.set(e.category, {
      impact: cat.bands.findIndex((b) => b.name === e.impactBand),
      lik: policy.compiled.likelihoodBands.indexOf(e.likelihoodBand!),
    });
  }
  const triggers = new Set(
    result.status === "ROUTED" ? result.derivation.composition!.triggers.filter((t) => t.fired).map((t) => t.id) : []
  );
  return { cats, triggers };
}

describe("engine properties", () => {
  it("P0 generated policies are lint-clean (generator cross-tests the linter)", () => {
    fc.assert(
      fc.property(policyShapeArb, (shape) => {
        const doc = compileCached(buildPolicyFromShape(shape)).document;
        expect(lintPolicy(doc).filter((f) => f.severity === "error")).toEqual([]);
      }),
      NUM_RUNS
    );
  });

  it("P1 determinism: byte-identical derivations on repeat", () => {
    fc.assert(
      fc.property(caseArb, ({ doc, factSet, subject }) => {
        const policy = compileCached(doc);
        const a = run(policy, factSet, subject);
        const b = run(policy, factSet, subject);
        expect(canonicalize(a as never)).toBe(canonicalize(b as never));
      }),
      NUM_RUNS
    );
  });

  it("P2 totality: schema-valid input never throws, result always parses", () => {
    fc.assert(
      fc.property(caseArb, ({ doc, factSet, subject }) => {
        const policy = compileCached(doc);
        const result = run(policy, factSet, subject);
        expect(() => ClassificationResult.parse(result)).not.toThrow();
      }),
      NUM_RUNS
    );
  });

  it("P3 upward-only composition: finalTier >= baseTier and >= every fired min_tier", () => {
    fc.assert(
      fc.property(caseArb, ({ doc, factSet, subject }) => {
        const policy = compileCached(doc);
        const r = run(policy, factSet, subject);
        if (r.status !== "ROUTED") return;
        const comp = r.derivation.composition!;
        expect(comp.finalTier).toBeGreaterThanOrEqual(comp.baseTier.tier);
        for (const t of comp.triggers) {
          if (t.fired && t.minTier !== undefined) expect(comp.finalTier).toBeGreaterThanOrEqual(t.minTier);
        }
      }),
      NUM_RUNS
    );
  });

  it("P4 monotonicity: a mutation the policy itself deems weakly riskier never lowers the tier", () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.nat(50),
        fc.constantFrom("amount_x3", "flag_flip", "to_not_found"),
        ({ doc, factSet, subject }, factPick, mutation) => {
          const policy = compileCached(doc);
          const before = run(policy, factSet, subject);
          fc.pre(before.status === "ROUTED");

          const candidates = factSet.facts.filter((f) => f.status === "FOUND");
          fc.pre(candidates.length > 0);
          const target = candidates[factPick % candidates.length]!;
          const mutated: FactSet = {
            facts: factSet.facts.map((f): Fact => {
              if (f.id !== target.id) return f;
              if (mutation === "to_not_found") return { id: f.id, status: "NOT_FOUND" } as Fact;
              if (mutation === "amount_x3" && typeof f.value === "number")
                return { ...f, value: f.value * 3 + 1 } as Fact;
              if (mutation === "flag_flip" && typeof f.value === "boolean")
                return { ...f, value: !f.value } as Fact;
              return f;
            }),
          };
          const after = run(policy, mutated, subject);
          if (after.status === "INCOMPLETE") return; // raising into needs_info is acceptable

          const pBefore = posture(policy, before);
          const pAfter = posture(policy, after);
          fc.pre(pBefore !== null && pAfter !== null);
          // keep only pairs the policy's own derivations deem weakly riskier
          for (const [cat, b] of pBefore!.cats) {
            const a = pAfter!.cats.get(cat)!;
            fc.pre(a.impact >= b.impact && a.lik >= b.lik);
          }
          for (const t of pBefore!.triggers) fc.pre(pAfter!.triggers.has(t));

          expect((after as { tier: number }).tier).toBeGreaterThanOrEqual((before as { tier: number }).tier);
        }
      ),
      { numRuns: 300 }
    );
  });

  // P5 generates many precondition-rejected cases (escalate category + FOUND
  // fact + below-conservative band), so its 300 runs draw far more samples
  // than the other properties. Under a parallel `pnpm test` the default 5s
  // vitest budget flakes; the property itself is untouched — it just gets the
  // time it needs.
  it("P5 unknown-dominance: NOT_FOUND below the conservative band never routes lower; escalated never self-approves", { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(caseArb, fc.nat(10), ({ doc, factSet, subject }, catPick) => {
        const policy = compileCached(doc);
        // pick an escalate category with a required fact
        const cats = policy.compiled.categories.filter(
          (c) => c.missingInfo.behavior === "escalate" && c.requiredFactIdxs.length > 0
        );
        fc.pre(cats.length > 0);
        const cat = cats[catPick % cats.length]!;
        const factId = policy.compiled.factTable[cat.requiredFactIdxs[0]!]!.id;
        const knownFact = factSet.facts.find((f) => f.id === factId && f.status === "FOUND");
        fc.pre(knownFact !== undefined);

        const known = run(policy, factSet, subject);
        fc.pre(known.status === "ROUTED");
        const knownEval = known.derivation.categoryEvaluations.find((e) => e.category === cat.id)!;
        const knownImpactIdx = cat.bands.findIndex((b) => b.name === knownEval.impactBand);
        const conservativeIdx = (cat.missingInfo as { conservativeBandIdx: number }).conservativeBandIdx;
        fc.pre(knownImpactIdx < conservativeIdx);

        const unknownSet: FactSet = {
          facts: factSet.facts.map((f): Fact => (f.id === factId ? ({ id: f.id, status: "NOT_FOUND" } as Fact) : f)),
        };
        const unknown = run(policy, unknownSet, subject);
        if (unknown.status !== "ROUTED") return; // INCOMPLETE (other categories) also blocks routing — safe
        expect(unknown.tier).toBeGreaterThanOrEqual((known as { tier: number }).tier);
        expect(unknown.tier).toBeGreaterThanOrEqual(1); // escalated never self-approves
      }),
      { numRuns: 300 }
    );
  });

  it("P6 agent >= human on identical facts", () => {
    fc.assert(
      fc.property(policyShapeArb, factChoicesArb, (shape, choices) => {
        const doc = buildPolicyFromShape(shape);
        const policy = compileCached(doc);
        const factSet = buildFactSet(policy.document, choices, true); // juris attested → agent not blocked
        const human = run(policy, factSet, { initiatorKind: "human", initiator: "user:x" });
        const agent = run(policy, factSet, { initiatorKind: "agent", initiator: "agent:x", onBehalfOf: "user:x" });
        fc.pre(human.status === "ROUTED" && agent.status === "ROUTED");
        expect((agent as { tier: number }).tier).toBeGreaterThanOrEqual((human as { tier: number }).tier);
      }),
      NUM_RUNS
    );
  });

  it("P7 pinning: derivation carries the policy hash and the input fact set verbatim", () => {
    fc.assert(
      fc.property(caseArb, ({ doc, factSet, subject }) => {
        const policy = compileCached(doc);
        const r = run(policy, factSet, subject);
        expect(r.derivation.policy.contentHash).toBe(policy.contentHash);
        expect(r.derivation.factSet).toEqual(factSet);
        expect(r.derivation.categoryEvaluations).toHaveLength(policy.compiled.categories.length);
      }),
      NUM_RUNS
    );
  });
});
