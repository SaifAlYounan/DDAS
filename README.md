# DDAS — Dynamic Delegation of Authority System

> *Static approval matrices assume a static world. This one doesn't.*

---

## The Problem

Every organisation has a Delegation of Authority table. It tells you who can approve what, up to how much, subject to which conditions. It is, almost without exception, a spreadsheet masquerading as a control framework.

The problem isn't that the table is wrong. The problem is that it is **frozen**. The authority threshold for a $5M contract signed in a stable market with a known counterparty should not be the same as the threshold for a $5M contract signed under time pressure with a first-time supplier during a liquidity crunch. Same amount. Different risk. Same table. That's the fiction.

DDAS replaces the frozen table with a **live risk engine**.

---

## What It Does

DDAS computes a dynamic approval threshold for any action — human-initiated or agent-initiated — by evaluating it against a weighted set of **Governance Units (GUs)**. Each GU captures a dimension of risk:

| Governance Unit | What it captures |
|---|---|
| **Financial Exposure** | Amount at stake, scaled to entity size |
| **Novelty** | Distance from precedent (new counterparty, new category) |
| **Reversibility** | How easily the action can be unwound |
| **Time Pressure** | Whether urgency is compressing the deliberation window |
| **Counterparty Risk** | Relational and reputational exposure |
| **Regulatory Sensitivity** | Sector, jurisdiction, compliance surface |
| **Agent Origin** | Whether the action was initiated by an AI agent |

The GU scores are aggregated into a composite **Risk Score**. That score is mapped to an approval tier — not a fixed approver, but a *required authority level* — which the system resolves against the current org structure at runtime.

The result: the same action, on different days, in different contexts, can route to different approvers. Not because the rules changed. Because the risk did.

---

## Why It Matters for Agents

Most governance frameworks weren't built for AI agents. They assume a human is initiating every action and can be held accountable in the usual ways. As agents become operational participants — executing contracts, triggering payments, managing workflows — that assumption collapses.

DDAS treats agents as first-class governance subjects. An action initiated by an autonomous agent carries a structural GU premium: it is evaluated against the same risk dimensions as a human action, plus an additional modifier that reflects the reduced interpretability of agent intent and the compressed human-in-the-loop window.

This isn't a restriction on agents. It's a **governance interface** that allows agents to operate at scale without dissolving institutional accountability.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    DDAS Engine                      │
│                                                     │
│  Action Input  ──►  GU Scoring Layer                │
│  (human/agent)       │                              │
│                      ▼                              │
│               Risk Aggregator                       │
│               (weighted composite)                  │
│                      │                              │
│                      ▼                              │
│               Threshold Resolver                    │
│               (maps score → authority tier)         │
│                      │                              │
│                      ▼                              │
│               Org Structure Lookup                  │
│               (resolves tier → approver)            │
│                      │                              │
│                      ▼                              │
│               Approval Router                       │
│               (notify / gate / log)                 │
└─────────────────────────────────────────────────────┘
```

---

## Stack

Built as a **pnpm monorepo** with full TypeScript across all packages.

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| API | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4 + drizzle-zod |
| API Contract | OpenAPI 3.1 + Orval codegen |
| Frontend | Vite + React |
| Build | esbuild (CJS bundle) |

### Repo Structure

```
ddas/
├── artifacts/
│   └── api-server/        # Express API — routes, middleware, response validation
├── lib/
│   ├── api-spec/          # OpenAPI spec + Orval codegen config
│   ├── api-client-react/  # Generated React Query hooks
│   ├── api-zod/           # Generated Zod schemas
│   └── db/                # Drizzle ORM schema + DB connection
├── scripts/               # Utility scripts (run via pnpm --filter)
└── src/                   # Frontend application
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 24
- pnpm
- PostgreSQL (or a `DATABASE_URL` connection string)

### Install

```bash
git clone https://github.com/SaifAlYounan/DDAS.git
cd DDAS
pnpm install
```

### Database Setup

```bash
pnpm --filter @workspace/db run push
```

### Development

```bash
# Start API server
pnpm --filter @workspace/api-server run dev

# Start frontend
pnpm run dev
```

### Build

```bash
pnpm run build
```

### Typecheck

```bash
pnpm run typecheck
```

---

## Conceptual Background

DDAS was designed as the implementation layer for the **GU Engine** — a governance framework that treats delegation of authority not as a static policy document but as a dynamic function of contextual risk.

The core insight is that most DoA frameworks fail not because they set wrong thresholds, but because they set *fixed* thresholds. Risk is not fixed. Authority should track risk.

The GU model borrows from financial risk scoring (weighted factor models, composite indices) and applies it to institutional governance. The output is not a recommendation — it is a **routing instruction** with an auditable, explainable derivation.

This also makes DDAS natively compatible with multi-agent environments. An agent operating inside a DDAS-governed system has no special permissions and no special exemptions. It has a risk profile. The engine handles the rest.

---

## Built At

**Legal Quants Hackathon** — March 2025  
An initiative at the intersection of legal engineering, quantitative methods, and AI governance.

---

## License

MIT

---

## Author

[Alexios van der Slikke-Kirillov](https://github.com/SaifAlYounan) — autonomous commercial agent, governance infrastructure layer.
