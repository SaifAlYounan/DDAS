# ADR 0004 — ACOS: Appetite-Constrained Ordinal Sorting replaces the weighted sum

**Status:** accepted · 2026-07-08

## Decision

The v1 "GU" model — LLM-assigned 1–10 scores, weighted composite
GU = Σ(score × weight × 10), floor-rule patches, tier thresholds on the
composite — is retired. DDAS v2 classifies with **Appetite-Constrained Ordinal
Sorting (ACOS)**, a pure function over integer band indices:

1. Deterministic **band rules** (a small declarative DSL: comparisons, list
   membership, boolean logic — deliberately not Turing-complete) map extracted
   facts to a per-category (impact band, likelihood band) exposure on the
   company's own registered scales.
2. The pair indexes the company's registered **risk matrix** → rating.
3. The registered **appetite mapping** (rating → minimum tier, monotone,
   per category) is the machine-readable risk appetite statement; each category
   independently demands a tier.
4. **Composition is upward-only**: base tier = max over categories
   (non-compensability as the core), then named escalation triggers,
   a counts-not-sums accumulation rule (k categories ≥ rating → +1 tier),
   the agent-origin uplift (stricter agent-initiated appetite column or +1,
   never Self-approve), and the missing-information policy
   (`NOT_FOUND` → conservative band or `INCOMPLETE`; unknown never lowers a tier).

## Context — why the weighted sum dies

1. **Ordinal scores are not cardinal.** Anchor labels 1–10 cannot be multiplied
   by weights and summed; the arithmetic presupposes interval scales and
   cross-dimension exchange rates that do not exist.
2. **Full compensability is the wrong default.** Real risk appetite is written
   as per-category ceilings, not a fungible budget. The v1 floor rules were veto
   thresholds bolted onto a model whose core assumption they contradict — the
   floors were the real model; the sum was noise around them.
3. **Weight semantics are unfalsifiable.** No configurator can answer what
   "financial 0.25 vs regulatory 0.20" means operationally.
4. **Scale dependence.** Every weight or anchor edit silently moved all tier
   boundaries.

Alternatives considered: full ELECTRE TRI (right formal shape — ACOS is its
degenerate case at unanimity concordance with per-criterion vetoes — but its
concordance/λ knobs are unconfigurable by a GC/CFO); lexicographic decision
tables (adopted only as the trigger overlay); expected-loss models (rejected:
per-transaction loss distributions would be false precision); rigorously
elicited weighted composites (rejected: bakes compensability back in).

What survives from v1: non-compensability (promoted from patch to core), the
agent-origin premium (recast as appetite, not a score bump), the 5-tier ladder,
and the six risk dimensions (demoted from hardcode to forkable starter template).

## Consequences

- The engine does no arithmetic on risk values — only comparisons, lookups,
  max, and counting. Bit-identical determinism follows for free.
- Property-tested invariants (see `packages/engine`): monotonicity,
  unknown-dominance, upward-only composition, policy-version pinning, totality.
- Every decision explains itself in the company's own appetite language;
  the derivation records triggers *tested and not fired*, not just fired ones.
- Companies register what they already own (scales, matrix, appetite, DoA
  ladder). Registration validators enforce monotone appetites, matrices
  monotone on both axes, exhaustive ordered bands.
