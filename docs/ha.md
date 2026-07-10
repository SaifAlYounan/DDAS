# High availability (multi-replica) deployment

DDAS supports one HA topology: **N stateless app replicas over one Postgres,
with blobs on S3-compatible storage**. Postgres is the single source of truth
for everything that must be consistent; the app nodes hold no state a replica
peer would miss.

```
            ┌─────────────┐
   LB ────► │ app replica │──┐
            ├─────────────┤  │      ┌────────────┐
   LB ────► │ app replica │──┼────► │  Postgres  │  (sessions, rate limits,
            ├─────────────┤  │      └────────────┘   jobs, audit chain,
   LB ────► │ app replica │──┘      ┌────────────┐   webhook deliveries)
            └─────────────┘ ──────► │ S3 bucket  │  (document blobs)
                                    └────────────┘
```

No sticky sessions, no Redis, no leader election. Any replica can serve any
request; any replica can run any background job.

## What is shared where

| Concern | Mechanism | Multi-node behavior |
|---|---|---|
| Sessions | `sessions` table (sha256 of the cookie token) | a login on one node authenticates on every node |
| Rate limits | `rate_limit_counters`, one atomic upsert per request | one shared budget per class; N nodes cannot widen it |
| Background jobs (extraction, SLA, simulation) | pg-boss ≥10 (Postgres, SKIP LOCKED; its own schema migration is advisory-locked) | any node works any job, exactly-once claim |
| Webhook fanout | Postgres trigger on the audit INSERT creates the delivery row in the same transaction | delivery exists exactly once regardless of which node wrote the event |
| Webhook sending | worker on every node claims rows `FOR UPDATE SKIP LOCKED` | at most one node sends a given delivery attempt |
| Audit chain | transaction-scoped advisory lock inside the writing transaction | strict single sequence across all nodes |
| Boot migrations | drizzle migrator wrapped in a session advisory lock (`@ddas/db`) | concurrent cold boots serialize; the loser applies nothing |
| First-boot admin | advisory-locked check-then-insert transaction | exactly one admin row, ever |
| Blobs | `DDAS_BLOB_DRIVER=s3` (any S3-compatible store) | required for >1 replica unless the fs dir is on an RWX volume |
| OIDC login flow | `ddas_oidc_flow` cookie carries the PKCE verifier + state | callback may land on a different node than the redirect |

Proven end-to-end by `apps/server/src/ha.e2e.test.ts`: two full server
instances (workers included) are booted **concurrently against one pristine
Postgres** and the suite asserts single-run migrations/bootstrap, cross-node
sessions, the shared rate limit (traffic split across both nodes still 429s
at the shared cap), and exactly-once webhook delivery. It runs in the normal
`pnpm test` / CI suite whenever `TEST_DATABASE_URL` is set.

## Deliberate per-node residuals

- **The inner login limiter** (`makeLoginRateLimiter`, per attempted email +
  per IP) is in-memory **by design**. It is defense in depth underneath the
  Postgres-backed `auth` class limiter, which is the cross-replica backstop
  (default 30/min per IP, shared). Its keys embed attacker-controlled input
  (the attempted email); mirroring them into the shared store would hand
  unauthenticated clients a write primitive into that table. With R replicas
  the effective per-email budget widens to at most R × 10/min — still far
  under the shared cap. Accepted and documented; revisit only if replica
  counts grow past ~10.
- **Prometheus metrics** are per-process, as metrics should be. Scrape every
  pod (the usual Kubernetes pattern) and aggregate in the backend; don't
  point a scraper at the Service ClusterIP, which samples one random pod.
- **OIDC discovery cache** is a per-node memo of the IdP metadata — a cache,
  not state.

## Deploying with the Helm chart

```bash
helm install ddas deploy/helm/ddas \
  --set replicaCount=3 \
  --set database.url=postgres://… \
  --set env.DDAS_BLOB_DRIVER=s3 \
  --set env.DDAS_S3_BUCKET=ddas-blobs \
  --set env.DDAS_S3_REGION=eu-central-1 \
  --set env.DDAS_S3_ACCESS_KEY_ID=… \
  --set env.DDAS_S3_SECRET_ACCESS_KEY=…
```

- The chart pulls the released image
  `ghcr.io/legalquants/lqgovernance-ddas` by default (tag = the chart's
  `appVersion`); published multi-arch (amd64 + arm64) on every `v*` tag.
- `replicaCount > 1` **requires** shared blob storage. The chart fails at
  render time unless `env.DDAS_BLOB_DRIVER=s3` or
  `blobs.accessMode=ReadWriteMany` (RWX storage class) is set. Prefer s3.
- With the s3 driver the chart creates no PVC at all and uses RollingUpdate;
  with an RWO fs volume it stays single-writer (`Recreate`).
- A PodDisruptionBudget (`minAvailable: 1`) is rendered automatically when
  `replicaCount > 1`.
- Probes: readiness and liveness on `/healthz`. Shutdown: `preStop sleep 5`
  (endpoint removal propagates) then SIGTERM → Fastify drains in-flight
  requests within `terminationGracePeriodSeconds` (default 30).

## Scaling limits — read before going wide

- **Postgres is the ceiling.** Every request costs at least a session lookup
  and a rate-limit upsert; mutations also serialize briefly on the audit
  chain's advisory lock. That lock makes the audit sequence strictly ordered
  — and means write throughput scales until chain contention, not linearly
  with replicas. Scale Postgres (CPU, connections via a pooler) before
  adding app replicas past ~5.
- **Connection budget**: each replica holds a `pg` pool (default max 10) plus
  pg-boss's connections. Size `max_connections` or add pgbouncer accordingly.
- **Workers run everywhere**: each replica polls webhook deliveries (2 s
  default) and works pg-boss queues. SKIP LOCKED keeps them correct; the only
  cost of more replicas is a little idle polling.
- **Postgres itself is not made HA by this topology** — use your platform's
  managed HA/failover. DDAS reconnects through the same DATABASE_URL.
