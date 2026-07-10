import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import { loadOrgSnapshot, type OrgSnapshot } from "@ddas/db";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

const OrgSnapshotSchema = z.object({
  units: z.array(
    z.object({ key: z.string(), name: z.string(), parent: z.string().optional() })
  ),
  people: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      email: z.string().email().optional(),
      kind: z.enum(["human", "agent"]).optional(),
      owner: z.string().optional(),
      roles: z
        .array(
          z.enum(["admin", "policy_author", "approver", "requester", "auditor", "viewer"])
        )
        .optional(),
    })
  ),
  positions: z.array(
    z.object({
      key: z.string(),
      unit: z.string(),
      title: z.string(),
      tier: z.number().int().nonnegative(),
      holder: z.string().optional(),
      validFrom: z.string().optional(),
    })
  ),
  delegations: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        maxTier: z.number().int().nonnegative(),
        scopeUnit: z.string().optional(),
        validFrom: z.string(),
        validTo: z.string().optional(),
        reason: z.string(),
      })
    )
    .optional(),
});

export function registerOrgRoutes(app: App, ctx: AppContext): void {
  app.get(
    "/org/tree",
    {
      schema: {
        tags: ["org"],
        response: {
          200: z.object({
            units: z.array(
              z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() })
            ),
            positions: z.array(
              z.object({
                id: z.string(),
                orgUnitId: z.string(),
                title: z.string(),
                authorityTier: z.number(),
                holders: z.array(
                  z.object({
                    assignmentId: z.string(),
                    principalId: z.string(),
                    name: z.string(),
                    validFrom: z.string(),
                    validTo: z.string().nullable(),
                  })
                ),
              })
            ),
            delegations: z.array(
              z.object({
                id: z.string(),
                from: z.string(),
                to: z.string(),
                maxTier: z.number(),
                scopeUnitId: z.string().nullable(),
                validFrom: z.string(),
                validTo: z.string().nullable(),
                reason: z.string(),
              })
            ),
          }),
        },
      },
      preHandler: [app.requireAuth],
    },
    async () => {
      const units = await ctx.pool.query<{ id: string; name: string; parent_id: string | null }>(
        "SELECT id, name, parent_id FROM org_units ORDER BY created_at"
      );
      const positions = await ctx.pool.query<{
        id: string;
        org_unit_id: string;
        title: string;
        authority_tier: number;
      }>("SELECT id, org_unit_id, title, authority_tier FROM positions ORDER BY authority_tier DESC, created_at");
      const assignments = await ctx.pool.query<{
        id: string;
        position_id: string;
        principal_id: string;
        name: string;
        valid_from: Date;
        valid_to: Date | null;
      }>(
        `SELECT a.id, a.position_id, a.principal_id, p.name, a.valid_from, a.valid_to
         FROM position_assignments a JOIN principals p ON p.id = a.principal_id
         ORDER BY a.created_at`
      );
      const delegations = await ctx.pool.query<{
        id: string;
        from_principal_id: string;
        to_principal_id: string;
        max_tier: number;
        org_unit_scope_id: string | null;
        valid_from: Date;
        valid_to: Date | null;
        reason: string;
      }>("SELECT * FROM delegations ORDER BY created_at");

      return {
        units: units.rows.map((u) => ({ id: u.id, name: u.name, parentId: u.parent_id })),
        positions: positions.rows.map((p) => ({
          id: p.id,
          orgUnitId: p.org_unit_id,
          title: p.title,
          authorityTier: p.authority_tier,
          holders: assignments.rows
            .filter((a) => a.position_id === p.id)
            .map((a) => ({
              assignmentId: a.id,
              principalId: a.principal_id,
              name: a.name,
              validFrom: a.valid_from.toISOString(),
              validTo: a.valid_to?.toISOString() ?? null,
            })),
        })),
        delegations: delegations.rows.map((d) => ({
          id: d.id,
          from: d.from_principal_id,
          to: d.to_principal_id,
          maxTier: d.max_tier,
          scopeUnitId: d.org_unit_scope_id,
          validFrom: d.valid_from.toISOString(),
          validTo: d.valid_to?.toISOString() ?? null,
          reason: d.reason,
        })),
      };
    }
  );

  app.post(
    "/org/import",
    {
      schema: {
        tags: ["org"],
        querystring: z.object({ dryRun: z.coerce.boolean().default(false) }),
        body: OrgSnapshotSchema,
        response: {
          200: z.object({
            dryRun: z.boolean(),
            units: z.number(),
            people: z.number(),
            positions: z.number(),
            delegations: z.number(),
          }),
        },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const snapshot = request.body as OrgSnapshot;
      const { dryRun } = request.query;
      const actor = { kind: "principal" as const, id: request.principal!.id };
      const counts = {
        units: snapshot.units.length,
        people: snapshot.people.length,
        positions: snapshot.positions.length,
        delegations: snapshot.delegations?.length ?? 0,
      };

      if (dryRun) {
        // Validate by loading inside a transaction we then roll back.
        const client = await ctx.pool.connect();
        try {
          await client.query("BEGIN");
          const db = (await import("@ddas/db")).createDb(
            // drizzle over the tx client: use a one-off client-bound instance
            client as never
          );
          await loadOrgSnapshot(db, snapshot);
          return { dryRun: true, ...counts };
        } catch (err) {
          throw new ApiError("validation_failed", `org snapshot rejected: ${String(err)}`);
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
          client.release();
        }
      }

      await withTx(ctx.pool, async (client) => {
        const db = (await import("@ddas/db")).createDb(client as never);
        await loadOrgSnapshot(db, snapshot);
        await appendAuditEvent(client, {
          actor,
          type: "org.imported",
          entity: { type: "org", id: "snapshot" },
          payload: counts,
        });
      });
      return { dryRun: false, ...counts };
    }
  );

  app.post(
    "/org/units",
    {
      schema: {
        tags: ["org"],
        body: z.object({ name: z.string().min(1), parentId: z.string().uuid().optional() }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO org_units (name, parent_id) VALUES ($1, $2) RETURNING id",
          [request.body.name, request.body.parentId ?? null]
        );
        await appendAuditEvent(client, {
          actor,
          type: "org_unit.created",
          entity: { type: "org_unit", id: inserted.rows[0]!.id },
          payload: { name: request.body.name },
        });
        return { id: inserted.rows[0]!.id };
      });
    }
  );

  app.post(
    "/org/positions",
    {
      schema: {
        tags: ["org"],
        body: z.object({
          orgUnitId: z.string().uuid(),
          title: z.string().min(1),
          authorityTier: z.number().int().nonnegative(),
        }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO positions (org_unit_id, title, authority_tier) VALUES ($1, $2, $3) RETURNING id",
          [request.body.orgUnitId, request.body.title, request.body.authorityTier]
        );
        await appendAuditEvent(client, {
          actor,
          type: "position.created",
          entity: { type: "position", id: inserted.rows[0]!.id },
          payload: { title: request.body.title, authorityTier: request.body.authorityTier },
        });
        return { id: inserted.rows[0]!.id };
      });
    }
  );

  app.post(
    "/org/position-assignments",
    {
      schema: {
        tags: ["org"],
        body: z.object({
          positionId: z.string().uuid(),
          principalId: z.string().uuid(),
          validFrom: z.string().datetime(),
          validTo: z.string().datetime().optional(),
        }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO position_assignments (position_id, principal_id, valid_from, valid_to)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            request.body.positionId,
            request.body.principalId,
            request.body.validFrom,
            request.body.validTo ?? null,
          ]
        );
        await appendAuditEvent(client, {
          actor,
          type: "position_assignment.created",
          entity: { type: "position_assignment", id: inserted.rows[0]!.id },
          payload: { positionId: request.body.positionId, principalId: request.body.principalId },
        });
        return { id: inserted.rows[0]!.id };
      });
    }
  );

  app.post(
    "/org/delegations",
    {
      schema: {
        tags: ["org"],
        body: z.object({
          fromPrincipalId: z.string().uuid(),
          toPrincipalId: z.string().uuid(),
          maxTier: z.number().int().nonnegative(),
          orgUnitScopeId: z.string().uuid().optional(),
          validFrom: z.string().datetime(),
          validTo: z.string().datetime().optional(),
          reason: z.string().min(1),
        }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const body = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO delegations
             (from_principal_id, to_principal_id, max_tier, org_unit_scope_id, valid_from, valid_to, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            body.fromPrincipalId,
            body.toPrincipalId,
            body.maxTier,
            body.orgUnitScopeId ?? null,
            body.validFrom,
            body.validTo ?? null,
            body.reason,
          ]
        );
        const id = inserted.rows[0]!.id;
        await appendAuditEvent(client, {
          actor,
          type: "delegation.created",
          entity: { type: "delegation", id },
          payload: { ...body },
        });
        return { id };
      });
    }
  );

  app.delete(
    "/org/delegations/:id",
    {
      schema: {
        tags: ["org"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requirePermission("org.manage")],
    },
    async (request) => {
      const { id } = request.params;
      const actor = { kind: "principal" as const, id: request.principal!.id };
      await withTx(ctx.pool, async (client) => {
        // Revocation = end the validity window now (history stays replayable).
        const updated = await client.query(
          "UPDATE delegations SET valid_to = now() WHERE id = $1 AND (valid_to IS NULL OR valid_to > now())",
          [id]
        );
        if (updated.rowCount === 0) {
          throw new ApiError("not_found", `delegation ${id} not found or already ended`);
        }
        await appendAuditEvent(client, {
          actor,
          type: "delegation.revoked",
          entity: { type: "delegation", id },
          payload: {},
        });
      });
      return { ok: true };
    }
  );
}
