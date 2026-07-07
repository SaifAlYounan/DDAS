# ADR 0001 — Open-source, self-hosted, single-container

**Status:** accepted · 2026-07-08

## Decision

DDAS is an open-source (MIT) product deployed self-hosted: one Node.js server
container + Postgres + a blob volume, brought up with `docker compose up`.
Background work runs on pg-boss (Postgres-backed queue) — no Redis, no
microservices, no multi-tenant SaaS.

## Context

The data DDAS handles — transactions, contracts, an organization's registered
risk appetite — is exactly the data enterprises will not ship to a third-party
SaaS. Self-hosted removes that objection entirely and matches the deployment
model of comparable self-hosted enterprise OSS. A single well-factored
monorepo and a single deployable process keep the operational surface small
enough for one platform engineer to own.

## Consequences

- No tenant column anywhere; one deployment = one organization.
- `docker compose up` must always boot the whole product; that is a release gate.
- Enterprise integrations happen via webhooks and the versioned REST API
  (DDAS pushes; it does not crawl other systems).
