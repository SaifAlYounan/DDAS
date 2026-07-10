/**
 * Org-snapshot loader: turns a declarative JSON snapshot (units, positions,
 * people, assignments, delegations) into rows. Used by `ddas org import`,
 * the CSV import dry-run, and the testkit's Kolvarra org fixture.
 */
import type { Db } from "./index.js";
import {
  delegations,
  orgUnits,
  positionAssignments,
  positions,
  principals,
  roleAssignments,
} from "./schema.js";

export interface OrgSnapshot {
  units: Array<{ key: string; name: string; parent?: string }>;
  people: Array<{
    key: string;
    name: string;
    email?: string;
    kind?: "human" | "agent";
    owner?: string;
    roles?: Array<"admin" | "policy_author" | "approver" | "requester" | "auditor" | "viewer">;
  }>;
  positions: Array<{
    key: string;
    unit: string;
    title: string;
    tier: number;
    holder?: string;
    validFrom?: string;
  }>;
  delegations?: Array<{
    from: string;
    to: string;
    maxTier: number;
    scopeUnit?: string;
    validFrom: string;
    validTo?: string;
    reason: string;
  }>;
}

export interface LoadedOrg {
  unitIds: Map<string, string>;
  principalIds: Map<string, string>;
  positionIds: Map<string, string>;
}

function requireKey<V>(map: Map<string, V>, key: string, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`org snapshot: unknown ${what} "${key}"`);
  return v;
}

export async function loadOrgSnapshot(
  db: Db,
  snapshot: OrgSnapshot,
  opts: { validFrom?: Date } = {}
): Promise<LoadedOrg> {
  const defaultFrom = opts.validFrom ?? new Date(0);
  const unitIds = new Map<string, string>();
  const principalIds = new Map<string, string>();
  const positionIds = new Map<string, string>();

  // Units first (parents before children — snapshot order must be topological).
  for (const unit of snapshot.units) {
    const parentId = unit.parent
      ? requireKey(unitIds, unit.parent, "parent unit")
      : null;
    const [row] = await db
      .insert(orgUnits)
      .values({ name: unit.name, parentId })
      .returning({ id: orgUnits.id });
    unitIds.set(unit.key, row!.id);
  }

  // Humans before agents so owners resolve regardless of order.
  const people = [...snapshot.people].sort((a, b) =>
    (a.kind === "agent" ? 1 : 0) - (b.kind === "agent" ? 1 : 0)
  );
  for (const person of people) {
    const kind = person.kind ?? "human";
    const ownerPrincipalId =
      kind === "agent" ? requireKey(principalIds, person.owner ?? "", "agent owner") : null;
    const [row] = await db
      .insert(principals)
      .values({
        kind,
        name: person.name,
        email: person.email ?? null,
        ownerPrincipalId,
      })
      .returning({ id: principals.id });
    principalIds.set(person.key, row!.id);
    if (person.roles?.length) {
      await db.insert(roleAssignments).values(
        person.roles.map((role) => ({ principalId: row!.id, role }))
      );
    }
  }

  for (const position of snapshot.positions) {
    const [row] = await db
      .insert(positions)
      .values({
        orgUnitId: requireKey(unitIds, position.unit, "unit"),
        title: position.title,
        authorityTier: position.tier,
      })
      .returning({ id: positions.id });
    positionIds.set(position.key, row!.id);
    if (position.holder) {
      await db.insert(positionAssignments).values({
        positionId: row!.id,
        principalId: requireKey(principalIds, position.holder, "holder"),
        validFrom: position.validFrom ? new Date(position.validFrom) : defaultFrom,
      });
    }
  }

  for (const delegation of snapshot.delegations ?? []) {
    await db.insert(delegations).values({
      fromPrincipalId: requireKey(principalIds, delegation.from, "delegator"),
      toPrincipalId: requireKey(principalIds, delegation.to, "delegate"),
      maxTier: delegation.maxTier,
      orgUnitScopeId: delegation.scopeUnit
        ? requireKey(unitIds, delegation.scopeUnit, "scope unit")
        : null,
      validFrom: new Date(delegation.validFrom),
      validTo: delegation.validTo ? new Date(delegation.validTo) : null,
      reason: delegation.reason,
    });
  }

  return { unitIds, principalIds, positionIds };
}
