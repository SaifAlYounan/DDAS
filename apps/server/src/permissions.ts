/**
 * The fixed permission catalog and the built-in role → permission-set map
 * (ADR 0005). The catalog is EXTRACTED from the pre-existing requireRole
 * gates and the role-shaped branch of assertRequestAccess — each gate site
 * maps to exactly one permission — and it is a CLOSED union: adding a
 * permission is a deliberate, reviewed act, like extending the audit-event
 * union.
 *
 * Built-in roles are immutable predefined sets defined HERE, never in the
 * database; custom roles (stored sets) are unioned in at request time.
 * Grants are additive-only: no deny rules, absence = deny, so the union is
 * monotone and order-independent.
 */
import type { Role } from "./plugins/auth.js";

export const PERMISSIONS = [
  /** POST /requests, POST /requests/:id/cancel; owner-path fact review. */
  "requests.submit",
  /** Wide READ visibility over any request (assertRequestAccess read mode). */
  "requests.read",
  /** Fact-review writes on ANY request: attest/correct, confirm, clone. */
  "facts.attest",
  /** Approvals inbox + approve/reject. */
  "decisions.decide",
  /** GET /approval-tasks/:id (the approver/auditor read surface). */
  "approvals.read",
  /** POST /classifications/:id/replay — the audit-replay procedure. */
  "classifications.replay",
  /** Lint + draft policy versions. */
  "policies.author",
  /** Activate/retire policy versions. */
  "policies.activate",
  /** POST /simulations. */
  "simulations.run",
  /** Org structure writes: units, positions, assignments, delegations, import. */
  "org.manage",
  /** GET /audit/events, GET /audit/checkpoint. */
  "audit.read",
  /** POST /audit/verify. */
  "audit.verify",
  // admin.* — NEVER grantable to custom roles (enforced here, in the API,
  // and by a Postgres CHECK). admin stays exclusively the built-in role.
  "admin.principals",
  "admin.roles",
  "admin.api_keys",
  "admin.webhooks",
  "admin.settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isKnownPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** admin.* is the non-grantable slice of the catalog (ADR 0005). */
export function isAdminPermission(value: string): boolean {
  return value.startsWith("admin.");
}

/** The permissions a custom role may carry: the catalog minus admin.*. */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !isAdminPermission(permission)
);

/**
 * The six immutable built-in sets. `admin` holds the FULL catalog — that is
 * how the old requireRole admin bypass is preserved without a special case
 * in the gate. `requester` deliberately does NOT hold facts.attest: it
 * reaches the fact-review routes via requests.submit and is then confined
 * to its own requests by assertRequestAccess's owner check; facts.attest is
 * the reviewer-wide write capability.
 */
export const BUILTIN_ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: PERMISSIONS,
  policy_author: [
    "policies.author",
    "policies.activate",
    "simulations.run",
    "classifications.replay",
  ],
  approver: [
    "decisions.decide",
    "approvals.read",
    "facts.attest",
    "requests.read",
    "classifications.replay",
  ],
  auditor: ["audit.read", "audit.verify", "approvals.read", "requests.read", "classifications.replay"],
  requester: ["requests.submit"],
  viewer: ["requests.read"],
};

/**
 * Effective permissions = union(built-in sets for the held roles, stored
 * custom-role grants). FAIL-CLOSED: a stored string that is not in the
 * compiled catalog (written by a newer version, or tampered) is ignored and
 * reported via `onUnknown`, never granted.
 */
export function resolvePermissions(
  roles: readonly string[],
  storedGrants: readonly string[],
  onUnknown?: (permission: string) => void
): ReadonlySet<Permission> {
  const resolved = new Set<Permission>();
  for (const role of roles) {
    const set = BUILTIN_ROLE_PERMISSIONS[role as Role];
    if (set) for (const permission of set) resolved.add(permission);
  }
  for (const grant of storedGrants) {
    if (isKnownPermission(grant)) resolved.add(grant);
    else onUnknown?.(grant);
  }
  return resolved;
}
