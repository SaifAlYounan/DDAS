# SCIM 2.0 provisioning

DDAS speaks SCIM 2.0 (RFC 7643/7644) at **`/scim/v2`** so your identity
provider — Okta, Microsoft Entra ID, or anything SCIM-compliant — can create,
update, deactivate, and role-assign users automatically.

> **Why this isn't in `openapi.json`:** the committed OpenAPI document is the
> frozen `/api/v1` application contract (see [api-freeze.md](api-freeze.md)).
> SCIM is a separate, RFC-specified surface with its own media type
> (`application/scim+json`) and its own error envelope
> (`urn:ietf:params:scim:api:messages:2.0:Error`) — folding its hand-shaped
> schemas into the generated spec would pollute the freeze diff without making
> the surface any better specified than the RFCs already do. The SCIM routes
> are therefore hidden from the generated document and specified here.

## Authentication

SCIM uses a dedicated long-lived bearer token — a DDAS API key with the
**exclusive `scim` scope**:

- Mint one in **Admin → SCIM provisioning** (token shown once), or via REST:

  ```bash
  curl -X POST https://ddas.example.com/api/v1/admin/api-keys \
    -H 'content-type: application/json' -b <admin-session-cookie> \
    -d '{"principalId":"<your-admin-id>","scopes":["scim"]}'
  ```

- The scope is exclusive both ways: a `scim` token is refused on every
  non-SCIM route, and no other credential (session cookie, normal API key)
  can call `/scim/v2`. Minting a key that mixes `scim` with other scopes is
  refused.
- Revoke from the same admin card (or `DELETE /api/v1/admin/api-keys/:id`).
- The token is bound to the admin who minted it: deactivating that admin
  revokes the token (mint a fresh one from another admin account first).
- Rate-limit class: `admin`.

## What is implemented

| Endpoint | Notes |
|---|---|
| `GET /scim/v2/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | discovery |
| `GET /scim/v2/Users` | `filter=userName eq "…"` (case-insensitive; also `externalId eq`, `emails.value eq`, `userName sw`), `startIndex`/`count` pagination |
| `POST /scim/v2/Users` | 201; duplicate userName → 409 `uniqueness` |
| `GET /scim/v2/Users/:id` | |
| `PUT /scim/v2/Users/:id` | replaces userName/displayName/active; an **omitted `externalId` is preserved** (never silently unlinked) |
| `PATCH /scim/v2/Users/:id` | ops `add`/`replace`/`remove` on `userName`, `displayName`, `name.formatted`, `externalId`, `active` (also the path-less value-object form); unsupported attributes are ignored per RFC 7644 §3.5.2; Entra's string booleans (`"True"`/`"False"`) accepted |
| `DELETE /scim/v2/Users/:id` | **soft** — deactivates, never erases (audit history stays intact) |
| `GET /scim/v2/Groups[/:id]` | the six fixed role groups **plus one group per custom role** (ADR 0005); `filter=displayName eq "…"`, `excludedAttributes=members` |
| `PATCH /scim/v2/Groups/:id` | membership `add` / `remove` (incl. `members[value eq "<id>"]`) / `replace` |
| `PUT /scim/v2/Groups/:id` | wholesale membership replace |

Not implemented (not needed by Okta/Entra): ETags, bulk, sorting, `POST /.search`,
multi-clause filters. `meta.version` is absent; conditional requests are not honored.

## Mapping

- **SCIM User ↔ DDAS principal (humans only).** `userName` = email,
  `externalId` ↔ `principals.external_id`, `displayName`/`name.formatted` ↔
  name, `active` ↔ not disabled. **Agents are invisible to SCIM**: excluded
  from every listing, 404 on direct access, writes refused — agents are
  DDAS-managed (they answer to a human owner, not to the IdP).
- **SCIM Groups ARE the six roles** — there is no separate group entity.
  Group ids are the role names; display names are fixed:

  | Group id | displayName |
  |---|---|
  | `admin` | DDAS Admins |
  | `policy_author` | DDAS Policy Authors |
  | `approver` | DDAS Approvers |
  | `auditor` | DDAS Auditors |
  | `requester` | DDAS Requesters |
  | `viewer` | DDAS Viewers |

  Adding a user to a group grants the role; removing revokes it. Group
  displayName is immutable (400 `mutability`).

- **Custom roles surface as additional groups** (ADR 0005): each
  admin-defined role appears as a group with id = the role's UUID and
  `displayName "DDAS Custom: <name>"`. Membership add/remove/replace =
  assignment grant/revoke, audit-chained (`role.assigned` /
  `role.revoked` with `payload.customRoleId`). SCIM can neither create nor
  delete groups — role definitions live in the admin API
  (`/api/v1/admin/roles`), and **deleting a custom role that still has
  members is refused with 409**: empty its membership (via SCIM or the
  console) first, then delete. Custom roles can never carry `admin.*`
  permissions, so no last-admin concern arises through them.

## Deprovisioning

`active: false` (or `DELETE`) deactivates the principal and — in the same
transaction — **deletes all its sessions and revokes all its API keys**. A
deprovisioned user is locked out on their very next request. Reactivating
(`active: true`) re-enables login but resurrects no credential.

## Safety rails

- **Last-admin guard**: SCIM (and the admin API) refuse to deactivate the
  last enabled admin or revoke its `admin` role — 409. Replacing the admin
  group's members applies adds before removes, so a handover never passes
  through a zero-admin state.
- **Audit**: every SCIM mutation lands on the tamper-evident audit chain
  (`principal.created/updated/disabled/enabled`, `role.granted/revoked`,
  `role.assigned`/`role.revoked` for custom roles) with the SCIM token as
  the actor and `payload.via = "scim"`.

## Interop with OIDC SSO (no duplicate accounts)

- A SCIM-provisioned user who signs in via OIDC binds to the **same**
  principal (the JIT email-link path).
- A user who signed in first (JIT-provisioned) is adopted by SCIM: the IdP's
  matching query (`filter=userName eq "…"`) finds the principal, and its
  `PUT`/`PATCH` writes `externalId` onto it.

## Okta setup

1. Admin console → your DDAS app (SAML/OIDC) → **Provisioning** → Integration:
   *SCIM connector base URL* = `https://ddas.example.com/scim/v2`,
   *Unique identifier field* = `userName`, auth = **HTTP Header** with the
   minted bearer token. Test connector configuration.
2. Enable **Provisioning to App**: Create Users, Update User Attributes,
   Deactivate Users.
3. Push the role groups (Directory → Groups → Push Groups won't create
   groups — the six exist already; link by name, e.g. “DDAS Approvers”), or
   simply assign users and manage roles via group membership PATCHes.

## Microsoft Entra ID setup

1. Enterprise application → **Provisioning** → Automatic:
   *Tenant URL* = `https://ddas.example.com/scim/v2`,
   *Secret token* = the minted bearer token → Test connection.
2. Map `userPrincipalName → userName`, `displayName → displayName`,
   `objectId → externalId` (matching precedence: `userName` first).
3. Assign users/groups to the app and start provisioning. Entra's 40-minute
   cycle creates/updates/deactivates; role changes flow through the six
   groups.
