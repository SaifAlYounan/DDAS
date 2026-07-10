# ADR 0005 — Configurable RBAC: custom roles as permission sets over a fixed catalog

**Status:** accepted · 2026-07-10

## Decision

DDAS keeps its six built-in roles — `admin`, `policy_author`, `approver`,
`auditor`, `requester`, `viewer` — as **primitives**: the vocabulary SCIM,
OIDC, the console, and every existing integration speak. Configurability is
added *underneath* them, not instead of them:

1. **A fixed, enumerated permission catalog** is extracted from the existing
   authorization gates. Every `requireRole` site and the role-shaped branch of
   `assertRequestAccess` maps to exactly one permission. The catalog is a
   closed TypeScript union (`apps/server/src/permissions.ts`) — extending it
   is a deliberate, reviewed act, exactly like the audit-event union.

2. **Built-in roles become immutable predefined permission sets**, defined in
   code, never in the database. Their meaning can never be edited at runtime.
   A customer who wants "approver minus X" clones the approver set into a
   custom role and assigns that instead. This keeps every existing authz test
   true and SCIM group semantics stable by construction.

3. **Custom roles** are admin-defined named permission sets stored in
   Postgres (`custom_roles` + `custom_role_permissions`), assigned to
   principals via `custom_role_assignments` — a sibling of `role_assignments`
   (the built-in table keeps its enum column and every query over it
   untouched; a nullable-enum fork of that table was rejected).

4. **Gates check permissions, not roles.** `requireRole(...)` is replaced by
   `requirePermission(...perms)` (any-of, like `requireRole` was). A
   principal's effective permission set = union of its built-in roles' static
   sets and its custom roles' stored sets. `assertRequestAccess` keeps its
   object-level owner/agent-owner logic and consults permissions only for the
   role-shaped part (wide read = `requests.read`, wide write =
   `facts.attest`).

## The permission catalog (extracted, not invented)

| Permission | Gates it covers (all under `/api/v1`) | Built-in holders |
|---|---|---|
| `requests.submit` | `POST /requests`, `POST /requests/:id/cancel`; also satisfies the fact-review route gates for the *owner* path | requester, admin |
| `requests.read` | wide read visibility inside `assertRequestAccess` (any request's detail, documents, classification) | approver, auditor, viewer, admin |
| `facts.attest` | `PATCH /fact-sets/:id/facts/:factId`, `POST /fact-sets/:id/confirm`, `POST /fact-sets/:id/clone` — including on *other* principals' requests (the wide-write branch of `assertRequestAccess`) | approver, admin |
| `decisions.decide` | `GET /approvals/inbox`, `POST /approval-tasks/:id/approve`, `POST /approval-tasks/:id/reject` | approver, admin |
| `approvals.read` | `GET /approval-tasks/:id` | approver, auditor, admin |
| `classifications.replay` | `POST /classifications/:id/replay` | approver, auditor, policy_author, admin |
| `policies.author` | `POST /policies/lint`, `POST /policies/:slug/versions` | policy_author, admin |
| `policies.activate` | `POST /policy-versions/:id/activate`, `POST /policy-versions/:id/retire` | policy_author, admin |
| `simulations.run` | `POST /simulations` | policy_author, admin |
| `org.manage` | the six org-structure writes (`/org/units`, `/org/positions`, `/org/position-assignments`, `/org/delegations` create+revoke, `/org/import`) | admin |
| `audit.read` | `GET /audit/events`, `GET /audit/checkpoint` | auditor, admin |
| `audit.verify` | `POST /audit/verify` | auditor, admin |
| `admin.principals` | `/admin/principals` list/create, built-in role edits, custom-role assignment | admin |
| `admin.roles` | `/admin/roles` CRUD (this feature's own surface) | admin |
| `admin.api_keys` | `/admin/api-keys` mint/list/revoke | admin |
| `admin.webhooks` | `/admin/webhooks*` all five | admin |
| `admin.settings` | `/admin/settings` read/write | admin |

Notes on extraction fidelity:

- The old `requireRole` admin bypass ("admin passes every gate") is preserved
  by giving the built-in `admin` role the **full catalog**, not by a special
  case in the gate.
- The fact-review routes were `requireRole("requester", "approver")`; they
  become `requirePermission("facts.attest", "requests.submit")`. The
  requester passes the route via `requests.submit` and is then confined to
  its own requests by the unchanged owner check; `facts.attest` is the wide
  reviewer capability. Built-in `requester` deliberately does **not** hold
  `facts.attest` — otherwise any requester would gain reviewer-wide writes,
  breaking multi-tenant confinement.
- There is no `admin.scim` permission because there is no SCIM route gate to
  extract: SCIM authenticates exclusively by the `scim`-scoped API key
  (minted under `admin.api_keys`), never by role.
- The shared read surface (`GET /requests`, policy/org reads, `/auth/me`)
  stays on bare `requireAuth` exactly as before; those routes were never
  role-gated and remain object-checked where it matters.
- MCP is untouched: it authorizes by API-key scope plus its own-request
  guard, and never consulted roles.

## Safety invariants (enforced in code and DB)

- **`admin.*` permissions are not grantable to custom roles.** `admin`
  remains exclusively the built-in role. This was the decision point the
  alternative — letting custom roles hold admin-equivalent sets and extending
  the last-admin guard to them — was rejected as strictly more machinery for
  strictly more risk. Consequences: `assertNotLastAdmin` stays exactly as it
  is (it only ever needs to count the built-in `admin` role), and the
  identity/credential plane (principals, roles, keys, webhooks, settings) can
  never be reached through a stored permission row. Enforced at the API (422
  on any `admin.*` grant) **and** in Postgres (a CHECK constraint on
  `custom_role_permissions` rejecting `admin.%`), so even a bug or manual SQL
  cannot smuggle it in.
- **Additive-only grants.** A role is a set of permissions; there are no deny
  rules. Absence = deny. Union across roles is therefore order-independent
  and monotone: adding a role never removes a capability, removing one never
  adds one — the platform's upward-only philosophy applied to authz.
- **Fail-closed on unknown strings.** A stored permission not in the compiled
  catalog (e.g. written by a newer version, or tampered) is ignored and
  logged, never granted. Unknown SCIM/API inputs are rejected outright.
- **Built-ins are unreachable by the CRUD.** `/admin/roles` refuses to
  update or delete a built-in (422); a custom role cannot take a built-in
  role's name.
- **Everything is audit-chained.** `role.created` / `role.updated` /
  `role.deleted` on definitions; `role.assigned` / `role.revoked` (with
  `customRoleId`) on membership — via admin API and via SCIM alike.
- **`org.manage` stays admin-only by default** but is deliberately in the
  grantable catalog: delegating org-structure maintenance (positions,
  delegations) is a legitimate customer ask. It controls routing *structure*;
  it does not decide, author, or touch identity. Grant with care.

## Effect timing and HA (the caching story)

Role definitions and assignments take effect **on the next request**. The
auth hook already runs one identity query per request; it now also aggregates
the principal's stored custom-role permissions in the same round trip (a
correlated aggregate over `custom_role_assignments ⋈ custom_role_permissions`,
one index-backed lookup per request). There is **no cross-request cache**:
per the HA rule that bought us the Postgres rate-limit store, an in-memory
cache without cross-node invalidation is a correctness bug, and a
cross-node invalidation bus is not warranted for a per-principal aggregate
this cheap. Measure first; if it ever shows up in profiles, the upgrade path
is a short-TTL cache (bounded staleness, documented), not a bus. No session
invalidation is needed — sessions carry identity, never permissions.

## Routing is out of scope — deliberately

Approval routing references **authority tiers on positions** (org structure)
and delegations; it never consulted API roles and still doesn't. Custom roles
are API-surface authorization only. A custom role can never make someone an
eligible approver of an approval task — that remains exclusively a matter of
position assignments and delegations under `org.manage`. (The `approver`
*role* only opens the inbox/decide API; eligibility per task is snapshotted
by the resolver from the org model, unchanged.)

## SCIM surface

Custom roles appear as additional SCIM Groups with
`displayName "DDAS Custom: <name>"` and the role's UUID as the group id, next
to the six fixed groups. Membership add/remove/replace = assignment
grant/revoke, audit-chained like everything else. Groups are created and
deleted only through the admin API (as with the six fixed groups, SCIM cannot
create or delete groups); deleting a custom role that still has members is
refused with 409 — empty its membership first (docs/scim.md).

## Consequences

- The entire existing role matrix — every 401/403 in the e2e suites — holds
  **unchanged** after the refactor; that suite is the regression proof that
  built-in behavior is preserved bit-for-bit.
- New capability combinations ("read-only + attest", "policy author without
  activation") are one custom role away, without touching code or weakening
  the built-ins.
- The permission catalog is now the single authoritative statement of what
  the API surface can be sliced into; a new route must pick (or deliberately
  add) its permission at review time.
