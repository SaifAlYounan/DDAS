# ADR 0002 — Full platform scope, phased with a headless cut line

**Status:** accepted · 2026-07-08

## Decision

DDAS v2 is a full platform: risk engine + policy console + org structure +
approval routing + approver inbox + hash-chained audit trail + SSO. It is built
in phases with a hard cut line after Phase 1: **headless DDAS** (API + CLI:
register a policy, submit a transaction, get a tier with a cited derivation)
must be a complete, usable product on its own before any UI work starts.

## Context

A DoA replacement that cannot route to a real approver in a real org is a demo,
not a product. But platform features are worthless if the core classification
is not trustworthy — hence engine-first sequencing inside full-platform scope.

## Consequences

- Phase order: repo reset + science spec → headless core → platform UI/routing →
  SSO/webhooks/agents (MCP).
- Deliberately deferred: SCIM, S3 blob storage, configurable RBAC, HA.
- Agents are first-class principals from the data model up (one `principals`
  table, kind `human|agent`, every agent owned by an accountable human),
  even though the agent-facing MCP surface ships in Phase 3.
