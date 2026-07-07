/**
 * The DDAS classification core: Appetite-Constrained Ordinal Sorting (ACOS).
 * See docs/adr/0004-acos-risk-model.md.
 *
 * PURITY CONTRACT — this module is a pure function of its inputs:
 * no I/O, no clock, no environment, no randomness. The engine operates on
 * integer band indices only: comparisons, lookups, max, and counting.
 * It never performs arithmetic on risk values.
 *
 * INVARIANTS (property-tested in Phase 1; a PR weakening any needs an ADR):
 *  - Determinism: same (factSet, policy, subject) → byte-identical derivation.
 *  - Monotonicity: worsening any fact, raising any likelihood band, adding a
 *    trigger condition, or switching initiator human→agent never lowers the tier.
 *  - Unknown-dominance: a NOT_FOUND required fact never yields a lower tier
 *    than any known value below the conservative band, and never Self-approve.
 *  - Upward-only composition: nothing after the base-tier max lowers the tier.
 *  - Totality: any schema-valid input returns a result or a typed error, never throws.
 */
import type { CompiledPolicy } from "@ddas/policy";
import type { ClassificationResult, FactSet, Subject } from "./types.js";

export const ENGINE_VERSION = "2.0.0-alpha.0";

export interface ClassifyInput {
  factSet: FactSet;
  policy: CompiledPolicy;
  subject: Subject;
  documents: Array<{ name: string; sha256: string }>;
}

/**
 * Stage 2–5 of ACOS: exposure mapping → matrix lookup → appetite comparison →
 * upward-only composition (max over categories, triggers, accumulation,
 * agent uplift, missing-info policy).
 *
 * Phase 1 implements this behind the frozen signature.
 */
export function classify(_input: ClassifyInput): ClassificationResult {
  throw new Error("Not implemented — Phase 1 (see docs/adr/0004-acos-risk-model.md)");
}
