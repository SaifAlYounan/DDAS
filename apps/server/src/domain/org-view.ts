/** Load the org structure as the pure routing resolver's input. */
import type { OrgView } from "@ddas/routing";
import type pg from "pg";

export async function loadOrgView(client: pg.ClientBase): Promise<OrgView> {
  // Sequential on purpose: `client` may be a single tx client, and pg warns
  // (and will eventually throw) on concurrent queries against one client.
  const units = await client.query<{ id: string; parent_id: string | null }>(
    "SELECT id, parent_id FROM org_units ORDER BY created_at, id"
  );
  const positions = await client.query<{
    id: string;
    org_unit_id: string;
    authority_tier: number;
  }>("SELECT id, org_unit_id, authority_tier FROM positions ORDER BY created_at, id");
  const assignments = await client.query<{
    id: string;
    position_id: string;
    principal_id: string;
    valid_from: Date;
    valid_to: Date | null;
  }>(
    "SELECT id, position_id, principal_id, valid_from, valid_to FROM position_assignments ORDER BY created_at, id"
  );
  const delegations = await client.query<{
    id: string;
    from_principal_id: string;
    to_principal_id: string;
    max_tier: number;
    org_unit_scope_id: string | null;
    valid_from: Date;
    valid_to: Date | null;
  }>(
    "SELECT id, from_principal_id, to_principal_id, max_tier, org_unit_scope_id, valid_from, valid_to FROM delegations ORDER BY created_at, id"
  );

  return {
    units: units.rows.map((u) => ({ id: u.id, parentId: u.parent_id })),
    positions: positions.rows.map((p) => ({
      id: p.id,
      orgUnitId: p.org_unit_id,
      authorityTier: p.authority_tier,
    })),
    assignments: assignments.rows.map((a) => ({
      id: a.id,
      positionId: a.position_id,
      principalId: a.principal_id,
      validFrom: a.valid_from.toISOString(),
      validTo: a.valid_to?.toISOString() ?? null,
    })),
    delegations: delegations.rows.map((d) => ({
      id: d.id,
      fromPrincipalId: d.from_principal_id,
      toPrincipalId: d.to_principal_id,
      maxTier: d.max_tier,
      orgUnitScopeId: d.org_unit_scope_id,
      validFrom: d.valid_from.toISOString(),
      validTo: d.valid_to?.toISOString() ?? null,
    })),
  };
}

/**
 * The unit a principal's request originates from: their live position's unit,
 * falling back to the org root (deterministically the oldest root).
 */
export async function requesterUnitId(
  client: pg.ClientBase,
  principalId: string,
  asOf: Date
): Promise<string | null> {
  const assigned = await client.query<{ org_unit_id: string }>(
    `SELECT p.org_unit_id
     FROM position_assignments a JOIN positions p ON p.id = a.position_id
     WHERE a.principal_id = $1 AND a.valid_from <= $2
       AND (a.valid_to IS NULL OR $2 < a.valid_to)
     ORDER BY a.created_at, a.id LIMIT 1`,
    [principalId, asOf]
  );
  if (assigned.rows[0]) return assigned.rows[0].org_unit_id;
  const root = await client.query<{ id: string }>(
    "SELECT id FROM org_units WHERE parent_id IS NULL ORDER BY created_at, id LIMIT 1"
  );
  return root.rows[0]?.id ?? null;
}
