# ADR 0003 — Deterministic core; the LLM extracts facts, never scores

**Status:** accepted · 2026-07-08

## Decision

The only machine-learning component in DDAS is **fact extraction**: an LLM reads
transaction documents and emits typed facts, each carrying a verbatim citation
span that must string-match the source document, and an explicit `NOT_FOUND`
status when a fact is absent. Everything downstream — exposure mapping, matrix
lookup, appetite comparison, tier composition — is a pure deterministic function
of `(factSet, compiledPolicy)`.

## Context

"Reliably classifies" is only auditable if the classification is reproducible.
An LLM that assigns risk scores cannot be audited, only sampled. Concentrating
all model uncertainty into one measurable layer (extraction) makes the trust
boundary explicit and testable: extraction quality is benchmarked with golden
sets (precision/recall, citation fidelity, abstention quality, adversarial
suites); classification correctness is proven with property tests.

## Consequences

- `packages/engine` performs no I/O, reads no clock/env, uses no randomness.
  Engine version is an explicit input recorded in every derivation.
- Replaying `(facts, policyVersion)` through a pinned engine version must
  reproduce the derivation byte-identically — that replay IS the audit procedure.
- Natural-language explanations are template-generated from the derivation
  object, never LLM-generated, so they cannot diverge from the computation.
- Extractor model + prompt hash are pinned per release; regressions on the
  golden set block release.
