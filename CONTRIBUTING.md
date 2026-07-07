# Contributing to DDAS

Thanks for considering a contribution.

## Developer Certificate of Origin (DCO)

Every commit must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin](https://developercertificate.org/).
CI rejects unsigned commits. There is no CLA.

## Ground rules

- **The engine stays pure.** `packages/engine` performs no I/O, reads no clock,
  no environment, no randomness. Classification is a pure function of
  `(factSet, compiledPolicy)`. PRs that break this are rejected regardless of merit.
- **The LLM never assigns a score.** Extraction produces cited facts; the
  deterministic core produces tiers. Do not blur this boundary.
- **Explanations are templated from the derivation, never LLM-generated.**
- **The band-rule DSL stays small**: comparisons, list membership, boolean logic.
  No loops, no function calls, no Turing-completeness.
- **Engine invariants are law**: monotonicity, unknown-dominance, and the
  upward-only composition invariant are property-tested; a PR that weakens a
  property test needs an ADR.

## Workflow

1. Open an issue before large changes; architecture changes need an ADR in `docs/adr/`.
2. `pnpm install`, `pnpm typecheck`, `pnpm test` must pass.
3. Conventional Commits (`feat:`, `fix:`, `docs:`, ...).
