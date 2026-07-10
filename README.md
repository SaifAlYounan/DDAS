# LQGovernance - DDAS (Dynamic Delegation of Authority System)

> *A static approval matrix assumes a static world. This one doesn't.*

LQGovernance - DDAS replaces the corporate **Delegation of Authority table** — the spreadsheet that says "a manager may approve up to $X" — with your company's **registered risk matrix and risk appetite, executed as code**. Every transaction or action, initiated by a human **or an AI agent**, is classified against your own enterprise risk scales, and the system returns the **required authority tier** plus a fully cited, replayable derivation of how it got there. The same action, in a different context, routes to a different approver — not because the rules changed, but because the risk did.

**Self-hosted · open source (MIT) · one container + Postgres.** `docker compose up` is the whole product: REST API, web console, approval routing, background workers, an MCP server for AI agents, SCIM provisioning, and OIDC SSO.

Status: **v2.0.0-alpha** — feature-complete and covered by ~330 automated tests, API frozen additive-only (see [`docs/api-freeze.md`](docs/api-freeze.md)), not yet cut as a stable release.

---

## The trust model (read this first)

DDAS concentrates all residual risk in exactly one place — **extraction** — and makes everything downstream deterministic and auditable.

1. **The LLM only extracts cited facts.** It reads the transaction documents and proposes typed facts (amount, counterparty, jurisdiction, liability cap, termination rights…). Every "FOUND" fact must carry a **verbatim quote** that string-matches the source document; a quote that isn't an exact substring is rejected and retried, then downgraded to `NOT_FOUND`. The LLM never assigns a score, a rating, or a decision. This is the only machine-learning step. (See [ADR 0003](docs/adr/0003-deterministic-core-llm-extraction-only.md).)
2. **The engine is deterministic.** Extracted facts are mapped onto *your* ordinal scales, looked up in *your* risk matrix, and compared against *your* appetite — all with integer band arithmetic. No weights, no composite score, no ML. Replaying the same facts under the same policy version reproduces the derivation byte-for-byte. **That replay is the audit procedure.**
3. **The audit trail is a hash chain.** Every audit event's hash covers the previous event's hash, so rewriting any row breaks every hash after it. A database superuser can still rewrite the whole chain, so DDAS lets you **export signed checkpoints** and store them outside the deployment; verification is against a checkpoint you kept.

The explanation a reviewer reads is generated from the derivation object by **templates, never by an LLM**, so the human-readable rationale cannot diverge from the computation.

---

## How a decision is made — ACOS

DDAS uses **Appetite-Constrained Ordinal Sorting (ACOS)**. There is no risk "score" and no weighting. (Why the earlier weighted-sum model was retired: [ADR 0004](docs/adr/0004-acos-risk-model.md).)

1. **Extract** — the LLM emits cited facts (above).
2. **Map** — deterministic band rules place each fact on your **impact** and **likelihood** scales, per risk category.
3. **Look up** — `(impact, likelihood)` indexes your registered **risk matrix** → a rating in your own vocabulary (e.g. `High`).
4. **Compare** — your registered **appetite** (rating → minimum authority tier, per category) is the machine-readable risk-appetite statement.
5. **Compose, upward-only** — the final tier is the **maximum across categories** (one breached ceiling routes the whole action), then:
   - **escalation triggers** (named conditions that jump the tier),
   - a **counts-not-sums accumulation** rule (N categories at or above a rating uplift once),
   - **k-of-n** quorum approval where a tier demands multiple approvers,
   - an **agent uplift**: an agent-initiated action is scored against a stricter appetite row and floored so an **agent can never self-approve** — every agent request lands in a human's inbox, and the human owner is accountable.

Missing information **escalates conservatively or blocks** — it never degrades to "low risk". Worsening any fact, raising any likelihood, adding a trigger, or switching a request from human to agent can only ever raise the tier, never lower it (a property the engine's test suite enforces).

---

## Feature set (as built)

| Area | What it does |
|---|---|
| **ACOS engine** | Deterministic, ordinal, upward-only tier derivation with escalation triggers, accumulation, k-of-n quorum, and agent uplift. Pure functions, property-tested. |
| **Policy-as-code** | Risk matrix + appetite authored as a YAML policy, linted, versioned, activated/retired. Diff and simulate before activating. |
| **RBAC** | Six built-in roles (`admin`, `policy_author`, `approver`, `auditor`, `requester`, `viewer`) over a fixed 17-permission catalog, **plus configurable custom roles** — stored permission sets unioned in at request time. `admin.*` permissions are non-grantable to custom roles, enforced at the API, in the resolver, and by a Postgres `CHECK`. (See [ADR 0005](docs/adr/0005-configurable-rbac.md).) |
| **SCIM 2.0** | `/scim/v2` Users + Groups provisioning (RFC 7643/7644). Groups map to roles (built-in `DDAS …` groups and custom-role groups); IdP deprovision disables the principal. Isolated credential — a `scim`-scoped key authenticates nothing else, and no other key reaches SCIM. Deliberately hidden from the public OpenAPI document. (See [`docs/scim.md`](docs/scim.md).) |
| **OIDC / SSO** | Authorization-code + PKCE, JIT user provisioning. Linking an SSO identity to an existing account requires a **verified email** (`email_verified`); an unverified email can never claim an existing principal (returns a clean 409, never a takeover). |
| **API keys** | Scoped, hashed at rest, shown **once** at mint time. |
| **MCP server** | `POST /mcp` — an AI agent requests authority through the *same* pipeline, appetite gates, audit trail, and human inbox as everyone else. Facts the policy marks attestation-required must be attested by the agent's accountable **human** owner, not the agent. There is no approval tool and no approval scope: agents cannot self-approve. |
| **Webhooks** | Outbound event delivery, HMAC-signed (`X-DDAS-Signature: t=…,v1=…`), with retry/backoff and a dead-letter state. |
| **Blob storage** | Content-addressed document store behind an `fs \| s3` driver seam. `fs` (local directory) is the default; `s3` targets any S3-compatible store (AWS, MinIO, R2, Ceph) and **fails the boot** if the bucket is unreachable or credentials are wrong, rather than surfacing as a failed upload later. |
| **High availability** | N stateless app replicas over one Postgres. Sessions, rate-limit counters, and the webhook job queue are all Postgres-backed; boot-time migration, bootstrap, and queue setup are serialized by Postgres advisory locks so concurrent replica boots are safe. (See [`docs/ha.md`](docs/ha.md).) |
| **Audit** | Hash-linked event chain with a `verify` endpoint and exportable, externally-checkpointable heads. |
| **CLI (`ddas`)** | `policy lint/register/activate/list/show`, `submit`/`classify`, `simulate`, extraction `eval` against a golden corpus, `migrate`, and `backup create`/`restore` (restore verifies the audit chain against the manifest). |
| **Metrics** | `GET /metrics` in Prometheus format: `ddas_requests_total`, `ddas_classifications_total`, `ddas_decisions_total`, plus the standard `process_*`/`nodejs_*` collectors. `/healthz` and `/metrics` are never rate-limited. (See [`docs/dashboards.md`](docs/dashboards.md).) |

---

## Quickstart (Docker Compose)

**Prerequisites:** Docker with Compose v2 (`docker compose version`). Nothing else — the image builds from source inside the compose build, so no local Node, Postgres, or build tools are needed for this path.

```bash
git clone https://github.com/LegalQuants/LQGovernance-DDAS.git
cd LQGovernance-DDAS/deploy
docker compose up --build
```

This starts Postgres and one application container (API + web console + workers). Migrations run at boot, advisory-locked and **fatal on failure**. On first boot only, if no admin exists yet, the bootstrap admin is created from `DDAS_ADMIN_EMAIL` / `DDAS_ADMIN_PASSWORD`.

Then open **http://localhost:3000** and sign in with the bootstrap admin (defaults: `admin@example.com` / `change-me-please`).

> **Port already taken?** `DDAS_PORT=3210 docker compose up` maps the host port; the container always listens on 3000.

### The bootstrap-admin guard

The compose file ships with a placeholder password (`change-me-please`). The server **refuses to bootstrap an admin with a `change-me*` password** — the guard (`infra-C3`) exists because a placeholder like that clears the 12-char minimum but is obviously public. For the local demo, the compose file sets `DDAS_ALLOW_INSECURE_ADMIN=true` to allow it anyway. **Never set that in a real deployment** — give `DDAS_ADMIN_PASSWORD` a real secret and drop the escape hatch. Any admin can rotate their own password afterwards via `POST /api/v1/auth/password` (or the console), which invalidates every other session while keeping the acting session and API keys alive.

### Choosing an extraction provider

`DDAS_EXTRACTION_PROVIDER` selects where facts come from:

- **`stub`** — extracts nothing (every fact `NOT_FOUND`); needs no API key. Ideal for trialling the routing/approval flow with manually entered facts.
- **`anthropic`** — set `DDAS_EXTRACTION_MODEL` and `DDAS_EXTRACTION_API_KEY`.
- **`openai-compatible`** — any OpenAI-shaped endpoint (vLLM, Ollama, Azure, …); also set `DDAS_EXTRACTION_BASE_URL`.

Extraction is only invoked when you submit a request, so you can bring up the whole system without a provider configured (submissions then fail cleanly at extraction until you set one).

### Optional: S3-compatible blob storage

The default `fs` driver stores documents in a container volume. To use S3 instead, start the bundled MinIO with the compose profile and point the app at it:

```bash
docker compose --profile s3 up
```

Then uncomment the `DDAS_BLOB_DRIVER: s3` / `DDAS_S3_*` block in `deploy/docker-compose.yml` (endpoint `http://minio:9000`, bucket `ddas-blobs`, path-style on). The one-shot `minio-init` service creates the bucket.

---

## First run — from admin to a routed request

1. **Sign in** as the bootstrap admin at http://localhost:3000.
2. **Author a policy.** In the **Policies** console, register a YAML policy that declares your impact/likelihood scales, risk matrix, appetite, and authority tiers, then **activate** a version. (Your risk matrix and appetite are *authored as a policy file*; your org structure, users, and SLAs are configured in the UI.) A worked example lives in `packages/testkit/corpus/kolvarra/policy/kolvarra-risk.v1.yaml`.
3. **Model your org.** Create org units, positions, assignments, and delegations under **Org** (or `POST /api/v1/org/*`).
4. **Add principals and roles.** Create users and assign roles under **Admin** (or `POST /api/v1/admin/principals` then `POST /api/v1/admin/principals/:id/roles`). Custom roles are managed under **Admin › Roles** (`/api/v1/admin/roles`).
5. **Submit a request** (UI, `POST /api/v1/requests`, the `ddas submit` CLI, or an agent over MCP). Facts are extracted and cited; the engine derives the tier; the request lands in the right inbox with a full derivation you can inspect and replay.

### Mint an API key (REST)

```bash
curl -sX POST http://localhost:3000/api/v1/admin/api-keys \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"principalId":"<uuid>","scopes":["default"]}'
# → { "id": "...", "prefix": "...", "token": "<shown once — store it now>" }
```

The `token` is returned **once** and never again; only its hash is stored. The `scim` scope is exclusive — a SCIM key can carry no other scope, and no other key reaches `/scim/v2`.

---

## Configuration

Every secret is an environment variable (the database stores only password and API-key **hashes**; webhook signing secrets are stored recoverably because HMAC needs them). Copy [`.env.example`](.env.example) and fill it in. The essentials:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP bind. Compose maps the host side via `DDAS_PORT`. |
| `WEB_DIST` | unset | **Absolute** path to the built web console; unset = API-only. |
| `DDAS_ADMIN_EMAIL` / `DDAS_ADMIN_PASSWORD` | `admin@example.com` / — | First-boot admin (created only if no admin exists). Password ≥ 12 chars; `change-me*` is rejected unless `DDAS_ALLOW_INSECURE_ADMIN=true`. |
| `DDAS_ALLOW_INSECURE_ADMIN` | `false` | Escape hatch for a throwaway admin password. Never in production. |
| `DDAS_EXTRACTION_PROVIDER` | `anthropic` | `stub` \| `anthropic` \| `openai-compatible`. |
| `DDAS_EXTRACTION_MODEL` / `DDAS_EXTRACTION_API_KEY` | — | Model + key for a real provider. |
| `DDAS_EXTRACTION_BASE_URL` | — | Endpoint for `openai-compatible`. |
| `DDAS_BLOB_DRIVER` | `fs` | `fs` \| `s3`. |
| `BLOB_DIR` | `/data/blobs` | fs driver directory. |
| `DDAS_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_FORCE_PATH_STYLE` | — / — / — / — / — / `false` | s3 driver. Boot fails if the bucket is unreachable. `FORCE_PATH_STYLE=true` for MinIO/self-hosted. |
| `OIDC_ISSUER_URL` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URL` | — | Set all to enable "Sign in with SSO". `OIDC_DEFAULT_ROLES` seeds JIT users; `OIDC_ALLOW_INSECURE` permits `http://` issuers (labs only). |
| `COOKIE_SECRET` | unset | ≥ 32 chars; signs the OIDC login-flow cookie. Set in prod/HA (shared across replicas). |
| `TRUST_PROXY` | unset | `true`/`false` or an IP/CIDR allowlist. Honors `X-Forwarded-*` so cookies stay `Secure` and rate limits key per real client IP behind a TLS-terminating proxy. |
| `WEBHOOK_POLL_MS` / `WEBHOOK_RETRY_BASE_MS` | `2000` / `30000` | Delivery worker tuning. |
| `RATE_LIMIT_{AUTH,MUTATION,READ,ADMIN}_{LIMIT,WINDOW_SEC}` | see `.env.example` | Per-route-class fixed-window limits, Postgres-backed (shared across replicas). `0` disables a class. |

See [`.env.example`](.env.example) for the full annotated list.

---

## Running the published image

Pushing a `v*` git tag publishes an image to GHCR, tagged with the version (the tag minus its `v` prefix). The `:latest` tag moves **only for a stable release** — a prerelease tag (anything with a hyphen, e.g. `v2.0.0-alpha.0`) publishes its version tag only and never clobbers `:latest`.

```bash
docker pull ghcr.io/legalquants/lqgovernance-ddas:2.0.0-alpha.0   # a specific (pre)release
docker pull ghcr.io/legalquants/lqgovernance-ddas:latest          # the newest STABLE release
```

The compose quickstart **builds from source**; to run the published image instead, replace the `build:` block of the `app` service in `deploy/docker-compose.yml` with `image: ghcr.io/legalquants/lqgovernance-ddas:latest`.

For multi-replica / production deployment, use the Helm chart in [`deploy/helm/ddas`](deploy/helm/ddas) (single replica by default; set `replicaCount > 1` for HA; bring your own Postgres). It ships a hardened pod (non-root, `serviceAccount`, `securityContext`, `NetworkPolicy`, `PodDisruptionBudget`) and defaults `image.repository` to the GHCR image. Depth: [`docs/ha.md`](docs/ha.md).

---

## Development

Monorepo: pnpm workspaces + Turbo, Node **≥ 24**.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test        # needs a Postgres 16 at TEST_DATABASE_URL
pnpm lint
```

The test suite drives a real Postgres. Point it at one and run:

```bash
docker run --rm -d --name ddas-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:5432:5432 postgres:16
export TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/postgres
pnpm test
```

The S3 blob tests are skipped unless `TEST_S3_ENDPOINT` / `TEST_S3_ACCESS_KEY_ID` / `TEST_S3_SECRET_ACCESS_KEY` are set.

**Layout:**

```
apps/
  server/   Fastify 5 API, OIDC, SCIM, MCP, webhooks worker
  web/       React + Vite console (client generated from apps/server/openapi.json)
  cli/       the `ddas` CLI
packages/
  engine/       the deterministic ACOS engine (pure functions, property-tested)
  policy/        YAML policy parsing, linting, validation
  extraction/    the LLM extraction boundary (verbatim-citation enforcement)
  routing/       tier → approver routing
  audit/         the hash-linked audit chain
  blob/          fs | s3 content-addressed blob store
  db/            Drizzle schema, migrations, and the Postgres immutability layer
  testkit/       the Kolvarra golden corpus + metrics harness
deploy/        Dockerfile, docker-compose.yml, Helm chart
docs/          ADRs, HA, SCIM, API-freeze, dashboards
```

The web client is generated from the **committed** `apps/server/openapi.json`, never from a live server; CI fails if the routes drift from that file (regenerate with `pnpm --filter @ddas/server openapi:write`). The Postgres schema is Drizzle-generated — `pnpm --filter @ddas/db generate` must produce no diff.

---

## Documentation

- **Architecture decisions** — [`docs/adr/`](docs/adr/): open-source/self-hosted scope (0001, 0002), deterministic-core / LLM-extraction-only (0003), the ACOS risk model (0004), configurable RBAC (0005).
- **High availability** — [`docs/ha.md`](docs/ha.md)
- **SCIM provisioning** — [`docs/scim.md`](docs/scim.md)
- **API freeze policy** — [`docs/api-freeze.md`](docs/api-freeze.md)
- **Metrics & dashboards** — [`docs/dashboards.md`](docs/dashboards.md)
- **Contributing / security** — [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md)

---

## Limitations (honest)

- **v2.0.0-alpha.** Feature-complete and tested, but pre-stable-release. The `/api/v1` surface is frozen additive-only from v2.0.0.
- **Extraction is the trust boundary by design.** DDAS makes the LLM's output *checkable* (verbatim citations, deterministic scoring, replayable derivations) but does not make the LLM infallible — a fact it fails to find escalates or blocks rather than being silently scored low. Attested/high-stakes facts should be human-confirmed.
- **The audit chain defends against tampering only with external checkpoints.** A database superuser can rewrite the whole chain in place; the guarantee is that doing so breaks verification against a checkpoint you exported and stored elsewhere.
- **Reference Helm chart.** Production-shaped (hardened pod, HA-capable) but you bring your own Postgres, TLS/ingress, and secret management.

---

## License

MIT — see [`LICENSE`](LICENSE). Repository: **https://github.com/LegalQuants/LQGovernance-DDAS**
