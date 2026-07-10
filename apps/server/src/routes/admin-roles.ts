/**
 * Configurable RBAC (ADR 0005): CRUD for admin-defined custom roles — named
 * permission sets over the fixed catalog in ../permissions.ts.
 *
 * The six built-in roles are listed here READ-ONLY (ids "builtin:<role>")
 * so the console can show their permission sets; they are immutable by
 * construction — update/delete on them is refused, and a custom role cannot
 * take a built-in name. admin.* permissions are never grantable (enforced
 * here AND by a Postgres CHECK). Every definition change is audit-chained
 * and takes effect on the next request (permissions resolve per request).
 */
import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import {
  BUILTIN_ROLE_PERMISSIONS,
  isAdminPermission,
  isKnownPermission,
} from "../permissions.js";
import type { Role } from "../plugins/auth.js";

const BUILTIN_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full platform control, including identity and credentials. Not clonable.",
  policy_author: "Author, simulate, activate and retire risk policies.",
  approver: "Review facts and decide approval tasks on any request.",
  auditor: "Read and verify the audit chain; replay classifications.",
  requester: "Submit requests and manage own facts through review.",
  viewer: "Read-only visibility over requests, policies and the org.",
};

const RoleOut = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  builtin: z.boolean(),
  permissions: z.array(z.string()),
  members: z.number(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUILTIN_NAMES = new Set(Object.keys(BUILTIN_ROLE_PERMISSIONS));

/** 422 on anything a custom role may not carry — unknown or admin.*. */
function assertGrantable(permissions: readonly string[]): void {
  for (const permission of permissions) {
    if (!isKnownPermission(permission)) {
      throw new ApiError("validation_failed", `unknown permission "${permission}"`);
    }
    if (isAdminPermission(permission)) {
      throw new ApiError(
        "validation_failed",
        `"${permission}" is not grantable — admin.* permissions belong exclusively to the built-in admin role (ADR 0005)`
      );
    }
  }
}

/** Built-ins are immutable; everything else must be a real row id. */
function assertCustomRoleId(id: string): void {
  const bare = id.startsWith("builtin:") ? id.slice("builtin:".length) : id;
  if (BUILTIN_NAMES.has(bare.toLowerCase())) {
    throw new ApiError(
      "validation_failed",
      "built-in roles are immutable — clone the set into a custom role instead"
    );
  }
  if (!UUID_RE.test(id)) throw new ApiError("not_found", "custom role not found");
}

export function registerAdminRoleRoutes(app: App, ctx: AppContext): void {
  app.get(
    "/admin/roles",
    {
      schema: { tags: ["admin"], response: { 200: z.array(RoleOut) } },
      preHandler: [app.requirePermission("admin.roles")],
    },
    async () => {
      const builtinCounts = await ctx.pool.query<{ role: string; members: string }>(
        "SELECT role::text, count(*) AS members FROM role_assignments GROUP BY role"
      );
      const membersByBuiltin = new Map(
        builtinCounts.rows.map((r) => [r.role, Number(r.members)])
      );
      const custom = await ctx.pool.query<{
        id: string;
        name: string;
        description: string | null;
        permissions: string[] | null;
        members: string;
      }>(
        `SELECT cr.id, cr.name, cr.description,
                (SELECT array_agg(crp.permission ORDER BY crp.permission)
                   FROM custom_role_permissions crp WHERE crp.role_id = cr.id) AS permissions,
                (SELECT count(*) FROM custom_role_assignments cra WHERE cra.role_id = cr.id) AS members
         FROM custom_roles cr ORDER BY cr.created_at`
      );
      return [
        ...(Object.keys(BUILTIN_ROLE_PERMISSIONS) as Role[]).map((role) => ({
          id: `builtin:${role}`,
          name: role,
          description: BUILTIN_DESCRIPTIONS[role],
          builtin: true,
          permissions: [...BUILTIN_ROLE_PERMISSIONS[role]].sort(),
          members: membersByBuiltin.get(role) ?? 0,
        })),
        ...custom.rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          builtin: false,
          permissions: r.permissions ?? [],
          members: Number(r.members),
        })),
      ];
    }
  );

  app.post(
    "/admin/roles",
    {
      schema: {
        tags: ["admin"],
        body: z.object({
          name: z.string().trim().min(1).max(64),
          description: z.string().max(500).optional(),
          permissions: z.array(z.string()).default([]),
        }),
        response: { 200: z.object({ id: z.string() }) },
      },
      preHandler: [app.requirePermission("admin.roles")],
    },
    async (request) => {
      const { name, description, permissions } = request.body;
      if (BUILTIN_NAMES.has(name.toLowerCase())) {
        throw new ApiError(
          "validation_failed",
          `"${name}" is a built-in role name — pick another`
        );
      }
      assertGrantable(permissions);
      const actor = { kind: "principal" as const, id: request.principal!.id };
      const unique = [...new Set(permissions)];
      return withTx(ctx.pool, async (client) => {
        const clash = await client.query("SELECT 1 FROM custom_roles WHERE lower(name) = lower($1)", [
          name,
        ]);
        if (clash.rows[0]) {
          throw new ApiError("conflict", `a custom role named "${name}" already exists`);
        }
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO custom_roles (name, description) VALUES ($1, $2) RETURNING id",
          [name, description ?? null]
        );
        const id = inserted.rows[0]!.id;
        for (const permission of unique) {
          await client.query(
            "INSERT INTO custom_role_permissions (role_id, permission) VALUES ($1, $2)",
            [id, permission]
          );
        }
        await appendAuditEvent(client, {
          actor,
          type: "role.created",
          entity: { type: "custom_role", id },
          payload: { name, permissions: unique.sort() },
        });
        return { id };
      });
    }
  );

  app.put(
    "/admin/roles/:id",
    {
      schema: {
        tags: ["admin"],
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().trim().min(1).max(64).optional(),
          description: z.string().max(500).nullable().optional(),
          permissions: z.array(z.string()).optional(),
        }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requirePermission("admin.roles")],
    },
    async (request) => {
      const { id } = request.params;
      assertCustomRoleId(id);
      const { name, description, permissions } = request.body;
      if (name !== undefined && BUILTIN_NAMES.has(name.toLowerCase())) {
        throw new ApiError("validation_failed", `"${name}" is a built-in role name — pick another`);
      }
      if (permissions !== undefined) assertGrantable(permissions);
      const actor = { kind: "principal" as const, id: request.principal!.id };
      await withTx(ctx.pool, async (client) => {
        const existing = await client.query<{ name: string }>(
          "SELECT name FROM custom_roles WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!existing.rows[0]) throw new ApiError("not_found", "custom role not found");
        if (name !== undefined && name.toLowerCase() !== existing.rows[0].name.toLowerCase()) {
          const clash = await client.query(
            "SELECT 1 FROM custom_roles WHERE lower(name) = lower($1) AND id <> $2",
            [name, id]
          );
          if (clash.rows[0]) {
            throw new ApiError("conflict", `a custom role named "${name}" already exists`);
          }
        }
        const changed: Record<string, unknown> = {};
        if (name !== undefined) changed["name"] = name;
        if (description !== undefined) changed["description"] = description;
        await client.query(
          `UPDATE custom_roles SET
             name = coalesce($2, name),
             description = CASE WHEN $4 THEN $3 ELSE description END,
             updated_at = now()
           WHERE id = $1`,
          [id, name ?? null, description ?? null, description !== undefined]
        );
        if (permissions !== undefined) {
          const unique = [...new Set(permissions)].sort();
          await client.query("DELETE FROM custom_role_permissions WHERE role_id = $1", [id]);
          for (const permission of unique) {
            await client.query(
              "INSERT INTO custom_role_permissions (role_id, permission) VALUES ($1, $2)",
              [id, permission]
            );
          }
          changed["permissions"] = unique;
        }
        await appendAuditEvent(client, {
          actor,
          type: "role.updated",
          entity: { type: "custom_role", id },
          payload: { changed },
        });
      });
      return { ok: true };
    }
  );

  app.delete(
    "/admin/roles/:id",
    {
      schema: {
        tags: ["admin"],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requirePermission("admin.roles")],
    },
    async (request) => {
      const { id } = request.params;
      assertCustomRoleId(id);
      const actor = { kind: "principal" as const, id: request.principal!.id };
      await withTx(ctx.pool, async (client) => {
        const existing = await client.query<{ name: string }>(
          "SELECT name FROM custom_roles WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!existing.rows[0]) throw new ApiError("not_found", "custom role not found");
        const members = await client.query<{ count: string }>(
          "SELECT count(*) FROM custom_role_assignments WHERE role_id = $1",
          [id]
        );
        if (Number(members.rows[0]!.count) > 0) {
          throw new ApiError(
            "conflict",
            "the role still has members — remove every assignment (or SCIM group member) first"
          );
        }
        // permissions cascade with the role row
        await client.query("DELETE FROM custom_roles WHERE id = $1", [id]);
        await appendAuditEvent(client, {
          actor,
          type: "role.deleted",
          entity: { type: "custom_role", id },
          payload: { name: existing.rows[0].name },
        });
      });
      return { ok: true };
    }
  );

  // ---------- assignment (full-set, mirroring the built-in roles route) ----------

  app.post(
    "/admin/principals/:id/custom-roles",
    {
      schema: {
        tags: ["admin"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ roleIds: z.array(z.string().uuid()) }),
        response: {
          200: z.object({
            customRoles: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
        },
      },
      preHandler: [app.requirePermission("admin.principals")],
    },
    async (request) => {
      const { id } = request.params;
      const wanted = [...new Set(request.body.roleIds)];
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const principal = await client.query("SELECT 1 FROM principals WHERE id = $1", [id]);
        if (!principal.rows[0]) throw new ApiError("not_found", "principal not found");
        const roles = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM custom_roles WHERE id = ANY($1::uuid[])",
          [wanted]
        );
        if (roles.rows.length !== wanted.length) {
          throw new ApiError("not_found", "custom role not found");
        }
        const nameById = new Map(roles.rows.map((r) => [r.id, r.name]));
        const current = await client.query<{ role_id: string; name: string }>(
          `SELECT cra.role_id, cr.name FROM custom_role_assignments cra
           JOIN custom_roles cr ON cr.id = cra.role_id
           WHERE cra.principal_id = $1`,
          [id]
        );
        const held = new Set(current.rows.map((r) => r.role_id));
        for (const roleId of wanted) {
          if (!held.has(roleId)) {
            await client.query(
              "INSERT INTO custom_role_assignments (principal_id, role_id) VALUES ($1, $2)",
              [id, roleId]
            );
            await appendAuditEvent(client, {
              actor,
              type: "role.assigned",
              entity: { type: "principal", id },
              payload: { customRoleId: roleId, name: nameById.get(roleId) },
            });
          }
        }
        const wantedSet = new Set(wanted);
        for (const row of current.rows) {
          if (!wantedSet.has(row.role_id)) {
            await client.query(
              "DELETE FROM custom_role_assignments WHERE principal_id = $1 AND role_id = $2",
              [id, row.role_id]
            );
            await appendAuditEvent(client, {
              actor,
              type: "role.revoked",
              entity: { type: "principal", id },
              payload: { customRoleId: row.role_id, name: row.name },
            });
          }
        }
        const after = await client.query<{ id: string; name: string }>(
          `SELECT cr.id, cr.name FROM custom_role_assignments cra
           JOIN custom_roles cr ON cr.id = cra.role_id
           WHERE cra.principal_id = $1 ORDER BY cr.name`,
          [id]
        );
        return { customRoles: after.rows };
      });
    }
  );
}
