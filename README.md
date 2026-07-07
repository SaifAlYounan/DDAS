# DDAS — Dynamic Delegation of Authority System

> *Static approval matrices assume a static world. This one doesn't.*

**DDAS replaces the corporate Delegation of Authority table with your registered risk appetite, executed as code.** Any transaction or action — initiated by a human or an AI agent — is classified against your own enterprise risk matrix and risk tolerance, producing the required authority tier and a fully auditable derivation. The same action, in a different context, routes to a different approver. Not because the rules changed — because the risk did.

> ⚠️ **Status: headless core working (Phase 1 of 3).** The deterministic ACOS engine, policy compiler, LLM fact extraction, golden corpus, and `ddas` CLI are built and property-tested — policy in, documents in, tier + cited derivation out. The platform (web console, approval routing, audit chain) is Phase 2. The original March 2026 hackathon proof of concept is preserved on the [`archive/poc`](../../tree/archive/poc) branch.

---

## The problem

Every organisation has a Delegation of Authority table: who can approve what, up to how much. It is, almost without exception, a spreadsheet masquerading as a control framework. The problem isn't that the table is wrong — it's that it is **frozen**. A $5M contract with a known counterparty in a stable market and a $5M contract under time pressure with a first-time supplier carry the same threshold. Same amount. Different risk. Same table. That's the fiction.

Meanwhile your risk function already maintains the real thing: an enterprise risk matrix (impact × likelihood, per risk category) and a risk appetite statement. The DoA table just never talks to it. DDAS is the missing connection.

## How it classifies — no scores, no weights

DDAS v2 uses **Appetite-Constrained Ordinal Sorting (ACOS)**. There is no composite "risk score," no weights, and no LLM assigning numbers. (The v1 weighted-sum model is retired — the reasoning is in [ADR 0004](docs/adr/0004-acos-risk-model.md).)

1. **Extract** — an LLM reads the transaction documents and extracts typed facts (amounts, counterparty, jurisdiction, liability caps, termination rights…). Every fact carries a **verbatim citation** that must string-match the source, and an explicit `NOT_FOUND` when absent. This is the only machine-learning step, and it is benchmarked with golden sets.
2. **Map** — deterministic band rules place each fact pattern on **your** impact and likelihood scales, per risk category. The rule language is deliberately tiny: comparisons, list membership, boolean logic. Nothing to audit but predicates.
3. **Look up** — (impact, likelihood) indexes **your** registered risk matrix → a rating, in your vocabulary.
4. **Compare** — **your** registered appetite (rating → minimum authority tier, per category) is the machine-readable risk appetite statement. Each category independently demands a tier.
5. **Compose, upward only** — final tier = the maximum across categories (one breached ceiling routes the whole action — risks don't offset), then named escalation triggers (sanctions, related party, uncapped liability…), a counts-not-sums accumulation rule for "many medium risks," and a stricter appetite for agent-initiated actions. Missing information escalates or blocks; it never classifies as low risk.

Every decision explains itself in your own language:

> *"Routed to Board because the EUR 4,200,000 exposure falls in your **Severe** financial impact band; under your **agent-initiated** appetite, High financial risk requires Board approval. No liability cap was found — legal exposure was conservatively assessed per your missing-information policy."*

That explanation is generated from the derivation object by templates — never by an LLM — so it cannot diverge from the computation. Replaying the same facts under the same policy version reproduces the derivation byte-for-byte. **That replay is the audit procedure.**

## AI agents are governance subjects

Agents aren't bolted on; they're first-class principals. Every agent belongs to an accountable human. Agent-initiated actions are classified against a stricter appetite column (or a tier uplift), can never self-approve unless explicitly whitelisted, and flow through the same pipeline, inbox, and audit trail as human requests. Phase 3 exposes this natively over MCP: an agent requests authority, gets gated at the right tier, and proceeds when a human approves.

## What's in the box (target architecture)

Self-hosted, single container + Postgres, `docker compose up`:

- **Engine** — the pure deterministic ACOS classifier (`packages/engine`). No I/O, no clock, no randomness; property-tested invariants (monotonicity, unknown-dominance, upward-only composition).
- **Policy as code** — your risk matrix and appetite as versioned, immutable, content-hashed YAML (`packages/policy`, [schema](packages/policy/schema/policy.v1.schema.json), [starter template](packages/policy/templates/starter-balanced.yaml)).
- **Extraction** — bring-your-own-model fact extraction (Anthropic or any OpenAI-compatible endpoint) with citation validation.
- **Simulation & backtest** — replay stored facts under a draft policy without re-running any LLM: *"under this policy, 14 requests the CFO approved would have routed to the Board."* Policy activation without a simulation run requires an audited override.
- **Routing & inbox** — approval workflow against your live org structure: escalations, SLAs, delegations.
- **Audit** — append-only, hash-chained decision log; tamper-evidence verifiable offline.
- **Console** — policy authoring/diff/simulate/activate, a fact-review screen with highlighted citations, approver inbox.

## Roadmap

| Phase | Ships | Status |
|---|---|---|
| 0 | Repo reset, architecture decisions ([ADRs](docs/adr/)), policy schema v1, engine contracts, golden-set format | ✅ |
| 1 | Headless core: ACOS engine (property-tested), policy compiler/linter, cited fact extraction, `ddas` CLI, golden corpus + eval harness, LLM-free policy simulation | ✅ |
| 2 | The platform: routing, org, audit chain, web console, approver inbox | next |
| 3 | Enterprise & agents: OIDC/SSO, webhooks, MCP server, Helm | |

## Try it (headless)

```bash
pnpm install && pnpm build

# lint + register + activate a policy (start from the template)
node apps/cli/dist/main.js policy lint packages/policy/templates/starter-balanced.yaml
node apps/cli/dist/main.js policy register packages/policy/templates/starter-balanced.yaml
node apps/cli/dist/main.js policy activate starter-balanced@1

# submit a transaction (facts from a file, or --extract with DDAS_EXTRACTION_* set)
node apps/cli/dist/main.js submit contract.md --facts facts.json --initiator user:you
node apps/cli/dist/main.js classify sub-0001

# what would change under a draft policy? (replays stored facts — zero LLM calls)
node apps/cli/dist/main.js simulate draft-v2.yaml
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

Postgres for local development: `docker compose -f deploy/docker-compose.yml up`.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (DCO, and a few non-negotiables: the engine stays pure, the LLM never scores, explanations stay templated).

## Origin

DDAS began at the **Legal Quants Hackathon, March 2026** — an initiative at the intersection of legal engineering, quantitative methods, and AI governance. The hackathon proof of concept (LLM-scored dimensions, weighted composite) lives on [`archive/poc`](../../tree/archive/poc); v2 is the from-first-principles rebuild.

## License

MIT — [Alexios van der Slikke-Kirillov](https://github.com/SaifAlYounan)
