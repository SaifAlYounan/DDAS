import argon2 from "argon2";
import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import { ARGON2_OPTS } from "./auth.js";

const RoleEnum = z.enum(["admin", "policy_author", "approver", "requester", "auditor"]);

const PrincipalRow = z.object({
  id: z.string(),
  kind: z.enum(["human", "agent"]),
  name: z.string(),
  email: z.string().nullable(),
  ownerPrincipalId: z.string().nullable(),
  disabled: z.boolean(),
  roles: z.array(z.string()),
});

export function registerAdminRoutes(app: App, ctx: AppContext): void {
  app.get(
    "/admin/principals",
    {
      schema: { tags: ["admin"], response: { 200: z.array(PrincipalRow) } },
      preHandler: [app.requireRole("admin")],
    },
    async () => {
      const rows = await ctx.pool.query<{
        id: string;
        kind: "human" | "agent";
        name: string;
        email: string | null;
        owner_principal_id: string | null;
        disabled_at: Date | null;
        roles: string[] | null;
      }>(
        `SELECT p.id, p.kind, p.name, p.email, p.owner_principal_id, p.disabled_at,
                array_agg(r.role) FILTER (WHERE r.role IS NOT NULL) AS roles
         FROM principals p LEFT JOIN role_assignments r ON r.principal_id = p.id
         GROUP BY p.id ORDER BY p.created_at`
      );
      return rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        email: r.email,
        ownerPrincipalId: r.owner_principal_id,
        disabled: r.disabled_at !== null,
        roles: r.roles ?? [],
      }));
    }
  );

  app.post(
    "/admin/principals",
    {
      schema: {
        tags: ["admin"],
        body: z.object({
          kind: z.enum(["human", "agent"]).default("human"),
          name: z.string().min(1),
          email: z.string().email().optional(),
          password: z.string().min(12).optional(),
          ownerPrincipalId: z.string().uuid().optional(),
          roles: z.array(RoleEnum).default([]),
        }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const body = request.body;
      if (body.kind === "agent" && !body.ownerPrincipalId) {
        throw new ApiError("validation_failed", "an agent needs an accountable human owner");
      }
      if (body.kind === "human" && !body.email) {
        throw new ApiError("validation_failed", "a human principal needs an email");
      }
      const passwordHash = body.password
        ? await argon2.hash(body.password, ARGON2_OPTS)
        : null;
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO principals (kind, name, email, password_hash, owner_principal_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [body.kind, body.name, body.email ?? null, passwordHash, body.ownerPrincipalId ?? null]
        );
        const id = inserted.rows[0]!.id;
        for (const role of body.roles) {
          await client.query(
            "INSERT INTO role_assignments (principal_id, role) VALUES ($1, $2)",
            [id, role]
          );
        }
        await appendAuditEvent(client, {
          actor,
          type: "principal.created",
          entity: { type: "principal", id },
          payload: { kind: body.kind, name: body.name, roles: body.roles },
        });
        return { id };
      });
    }
  );

  app.post(
    "/admin/principals/:id/roles",
    {
      schema: {
        tags: ["admin"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ roles: z.array(RoleEnum) }),
        response: { 200: z.object({ roles: z.array(z.string()) }) },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const { id } = request.params;
      const { roles } = request.body;
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const existing = await client.query<{ role: string }>(
          "SELECT role FROM role_assignments WHERE principal_id = $1",
          [id]
        );
        const before = new Set(existing.rows.map((r) => r.role));
        const after = new Set<string>(roles);
        for (const role of after) {
          if (!before.has(role)) {
            await client.query(
              "INSERT INTO role_assignments (principal_id, role) VALUES ($1, $2)",
              [id, role]
            );
            await appendAuditEvent(client, {
              actor,
              type: "role.granted",
              entity: { type: "principal", id },
              payload: { role },
            });
          }
        }
        for (const role of before) {
          if (!after.has(role)) {
            await client.query(
              "DELETE FROM role_assignments WHERE principal_id = $1 AND role = $2",
              [id, role]
            );
            await appendAuditEvent(client, {
              actor,
              type: "role.revoked",
              entity: { type: "principal", id },
              payload: { role },
            });
          }
        }
        return { roles: [...after].sort() };
      });
    }
  );

  const Settings = z.object({ slaHoursByTier: z.record(z.string(), z.number().positive()) });

  app.get(
    "/admin/settings",
    {
      schema: { tags: ["admin"], response: { 200: Settings } },
      preHandler: [app.requireRole("admin")],
    },
    async () => {
      const row = await ctx.pool.query<{ sla_hours_by_tier: Record<string, number> }>(
        "SELECT sla_hours_by_tier FROM org_settings WHERE id = TRUE"
      );
      return { slaHoursByTier: row.rows[0]?.sla_hours_by_tier ?? {} };
    }
  );

  app.put(
    "/admin/settings",
    {
      schema: { tags: ["admin"], body: Settings, response: { 200: Settings } },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      const { slaHoursByTier } = request.body;
      await withTx(ctx.pool, async (client) => {
        await client.query(
          `INSERT INTO org_settings (id, sla_hours_by_tier) VALUES (TRUE, $1)
           ON CONFLICT (id) DO UPDATE SET sla_hours_by_tier = $1`,
          [JSON.stringify(slaHoursByTier)]
        );
        await appendAuditEvent(client, {
          actor,
          type: "settings.updated",
          entity: { type: "org_settings", id: "singleton" },
          payload: { slaHoursByTier },
        });
      });
      return { slaHoursByTier };
    }
  );
}
