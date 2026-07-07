# @ddas/testkit — the golden corpus

One excellent fictional company beats four mediocre fixture sets. The corpus
built here (Phase 1) is a single artifact used four ways:

1. **Extraction eval labels** — `ddas eval` scores every extractor/model on
   precision/recall per fact type, value accuracy, **citation fidelity** (the
   cited span must exist in the document and entail the fact), and
   **abstention quality** (absent facts must come back `NOT_FOUND`, never
   guessed — a hallucinated liability cap silently *lowers* risk, which is why
   the false-fact rate is the headline metric).
2. **Engine snapshots** — labeled fact sets replayed through the pure engine
   pin the derivation objects byte-for-byte.
3. **End-to-end expected routings** — ~50 transactions with expected tiers
   under a pinned policy, run through the real server in CI.
4. **Demo seed data** — the same company boots the reference deployment.

Case format: `schema/golden-set.v1.schema.json`. Adversarial cases (amounts
split across schedules, obligations buried in annexes, euphemistic termination
language) are tagged `adversarial` and tracked as a first-class red-team
benchmark — extraction is the system's main attack surface.
