/**
 * SCIM 2.0 provisioning (RFC 7643/7644) — the subset Okta and Entra drive:
 * Users CRUD with `filter=userName eq "..."`, PATCH (incl. `active`), soft
 * DELETE (deactivate), and Groups as the SIX FIXED ROLES — group membership
 * add/remove IS role grant/revoke; there is no separate group entity.
 *
 * Lives OUTSIDE /api/v1 (own prefix /scim/v2, own error envelope, own media
 * type) and outside the committed OpenAPI document (routes are hidden; the
 * surface is specified by the RFCs and documented in docs/scim.md).
 *
 * AuthN: a dedicated API key with the exclusive "scim" scope. SCIM accepts
 * ONLY that scope (session cookies and normal keys are refused), and the
 * scimKeyIsolationHook below keeps scim tokens out of every non-SCIM route.
 *
 * Mapping: userName ↔ principals.email (humans only — agents are invisible
 * to SCIM), externalId ↔ principals.external_id, displayName ↔ name,
 * active ↔ disabled_at IS NULL. Deactivation kills sessions and API keys in
 * the same transaction (domain/principals.ts). Every mutation is on the
 * audit chain; the last-admin guard holds on every path.
 */
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { App, AppContext } from "../app.js";
import { deactivatePrincipal, reactivatePrincipal, assertNotLastAdmin } from "../domain/principals.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";
import type { Role } from "../plugins/auth.js";
import {
  applyGroupPatch,
  applyUserPatch,
  parseFilter,
  parsePatchBody,
  coerceScimBool,
  ScimError,
  scimErrorBody,
  SCIM_URN,
  type UserPatchChanges,
} from "../scim/protocol.js";

const BASE_PATH = "/scim/v2";

/** The six fixed groups — the role-mapping surface IdPs push through. */
export const ROLE_GROUPS: ReadonlyArray<{ id: Role; displayName: string }> = [
  { id: "admin", displayName: "DDAS Admins" },
  { id: "policy_author", displayName: "DDAS Policy Authors" },
  { id: "approver", displayName: "DDAS Approvers" },
  { id: "auditor", displayName: "DDAS Auditors" },
  { id: "requester", displayName: "DDAS Requesters" },
  { id: "viewer", displayName: "DDAS Viewers" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Root-level guard: a "scim" token authenticates NOTHING outside /scim/v2.
 * Registered in app.ts before any route, right after the auth plugin.
 */
export async function scimKeyIsolationHook(request: FastifyRequest): Promise<void> {
  if (
    request.apiKey?.scopes.includes("scim") &&
    !(request.url.split("?")[0] ?? "").startsWith(BASE_PATH)
  ) {
    throw new ApiError("forbidden", 'a "scim" token is only valid on /scim/v2');
  }
}

function sendScim(reply: FastifyReply, status: number, body?: unknown): FastifyReply {
  if (body === undefined) return reply.status(status).send();
  return reply
    .status(status)
    .header("content-type", "application/scim+json; charset=utf-8")
    .send(JSON.stringify(body));
}

interface PrincipalRow {
  id: string;
  name: string;
  email: string | null;
  external_id: string | null;
  disabled_at: Date | null;
  created_at: Date;
  roles: string[] | null;
}

function toScimUser(row: PrincipalRow) {
  return {
    schemas: [SCIM_URN.user],
    id: row.id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    userName: row.email ?? "",
    displayName: row.name,
    name: { formatted: row.name },
    active: row.disabled_at === null,
    emails: row.email ? [{ value: row.email, primary: true }] : [],
    groups: (row.roles ?? [])
      .filter((role): role is Role => ROLE_GROUPS.some((g) => g.id === role))
      .sort()
      .map((role) => ({
        value: role,
        display: ROLE_GROUPS.find((g) => g.id === role)!.displayName,
        $ref: `${BASE_PATH}/Groups/${role}`,
      })),
    meta: {
      resourceType: "User",
      created: row.created_at.toISOString(),
      location: `${BASE_PATH}/Users/${row.id}`,
    },
  };
}

function listResponse(resources: unknown[], totalResults: number, startIndex: number) {
  return {
    schemas: [SCIM_URN.listResponse],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function pagination(query: Record<string, unknown>): { startIndex: number; count: number } {
  const startIndex = Math.max(1, Number(query["startIndex"] ?? 1) || 1);
  const rawCount = query["count"] === undefined ? 100 : Number(query["count"]);
  const count = Number.isFinite(rawCount) ? Math.min(Math.max(rawCount, 0), 200) : 100;
  return { startIndex, count };
}

/** Escape LIKE wildcards for the `sw` operator. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** filter → SQL predicate over principals p. Returns [clause, params]. */
function userFilterSql(filter: string): { clause: string; params: string[] } {
  const parsed = parseFilter(filter);
  if (parsed.attr === "username" || parsed.attr === "emails.value") {
    if (parsed.op === "eq") return { clause: "lower(p.email) = lower($1)", params: [parsed.value] };
    return { clause: "lower(p.email) LIKE lower($1) || '%'", params: [escapeLike(parsed.value)] };
  }
  if (parsed.attr === "externalid" && parsed.op === "eq") {
    return { clause: "p.external_id = $1", params: [parsed.value] };
  }
  if (parsed.attr === "displayname" && parsed.op === "eq") {
    return { clause: "lower(p.name) = lower($1)", params: [parsed.value] };
  }
  throw new ScimError(400, `unsupported filter attribute/operator: ${filter}`, "invalidFilter");
}

const USER_SELECT = `
  SELECT p.id, p.name, p.email, p.external_id, p.disabled_at, p.created_at,
         array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL) AS roles
  FROM principals p
  LEFT JOIN role_assignments r ON r.principal_id = p.id`;

async function loadUser(
  db: pg.Pool | pg.ClientBase,
  id: string
): Promise<PrincipalRow | null> {
  if (!UUID_RE.test(id)) return null;
  const result = await db.query<PrincipalRow>(
    `${USER_SELECT} WHERE p.id = $1 AND p.kind = 'human' GROUP BY p.id`,
    [id]
  );
  return result.rows[0] ?? null;
}

export function registerScimRoutes(app: App, ctx: AppContext): void {
  // IdPs send application/scim+json — parse it exactly like JSON.
  app.addContentTypeParser(
    "application/scim+json",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, body === "" ? null : JSON.parse(body as string));
      } catch (err) {
        done(new ScimError(400, `malformed JSON body: ${String(err)}`, "invalidSyntax"), undefined);
      }
    }
  );

  void app.register(
    async (scim) => {
      scim.setErrorHandler((err: unknown, request, reply) => {
        if (err instanceof ScimError) {
          return sendScim(reply, err.status, scimErrorBody(err.status, err.message, err.scimType));
        }
        if (err instanceof ApiError) {
          return sendScim(reply, err.statusCode, scimErrorBody(err.statusCode, err.message));
        }
        request.log.error({ err }, "unhandled SCIM error");
        return sendScim(reply, 500, scimErrorBody(500, "internal server error"));
      });

      // AuthN: ONLY a bearer API key carrying the "scim" scope.
      scim.addHook("onRequest", async (request) => {
        if (!request.apiKey || !request.principal) {
          throw new ScimError(401, 'SCIM requires a bearer token with the "scim" scope');
        }
        if (!request.apiKey.scopes.includes("scim")) {
          throw new ScimError(403, 'this credential lacks the "scim" scope');
        }
      });

      const actorOf = (request: FastifyRequest): AuditActor => ({
        kind: "api_key",
        id: request.apiKey!.id,
        principalId: request.principal!.id,
      });

      const HIDE = { schema: { hide: true } } as const;

      // ---------- discovery ----------

      scim.get("/ServiceProviderConfig", HIDE, async (_request, reply) =>
        sendScim(reply, 200, {
          schemas: [SCIM_URN.serviceProviderConfig],
          documentationUri: "https://github.com/SaifAlYounan/DDAS/blob/main/docs/scim.md",
          patch: { supported: true },
          bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
          filter: { supported: true, maxResults: 200 },
          changePassword: { supported: false },
          sort: { supported: false },
          etag: { supported: false },
          authenticationSchemes: [
            {
              type: "oauthbearertoken",
              name: "Bearer token",
              description: 'Long-lived DDAS API key with the exclusive "scim" scope',
            },
          ],
          meta: { resourceType: "ServiceProviderConfig", location: `${BASE_PATH}/ServiceProviderConfig` },
        })
      );

      const resourceTypes = [
        {
          schemas: [SCIM_URN.resourceType],
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: SCIM_URN.user,
          meta: { resourceType: "ResourceType", location: `${BASE_PATH}/ResourceTypes/User` },
        },
        {
          schemas: [SCIM_URN.resourceType],
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          schema: SCIM_URN.group,
          meta: { resourceType: "ResourceType", location: `${BASE_PATH}/ResourceTypes/Group` },
        },
      ];
      scim.get("/ResourceTypes", HIDE, async (_request, reply) =>
        sendScim(reply, 200, listResponse(resourceTypes, resourceTypes.length, 1))
      );
      scim.get("/ResourceTypes/:id", HIDE, async (request, reply) => {
        const found = resourceTypes.find(
          (t) => t.id === (request.params as { id: string }).id
        );
        if (!found) throw new ScimError(404, "resource type not found");
        return sendScim(reply, 200, found);
      });

      const schemas = [
        {
          schemas: [SCIM_URN.schema],
          id: SCIM_URN.user,
          name: "User",
          description: "DDAS user (a human principal). userName is the email.",
          attributes: [
            { name: "userName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readWrite", uniqueness: "server" },
            { name: "displayName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", uniqueness: "none" },
            { name: "externalId", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readWrite", uniqueness: "server" },
            { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite" },
            { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readOnly" },
            { name: "groups", type: "complex", multiValued: true, required: false, mutability: "readOnly" },
          ],
          meta: { resourceType: "Schema", location: `${BASE_PATH}/Schemas/${SCIM_URN.user}` },
        },
        {
          schemas: [SCIM_URN.schema],
          id: SCIM_URN.group,
          name: "Group",
          description: "DDAS role group — one of the six fixed roles. displayName is immutable.",
          attributes: [
            { name: "displayName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readOnly", uniqueness: "server" },
            { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite" },
          ],
          meta: { resourceType: "Schema", location: `${BASE_PATH}/Schemas/${SCIM_URN.group}` },
        },
      ];
      scim.get("/Schemas", HIDE, async (_request, reply) =>
        sendScim(reply, 200, listResponse(schemas, schemas.length, 1))
      );
      scim.get("/Schemas/:id", HIDE, async (request, reply) => {
        const found = schemas.find((s) => s.id === (request.params as { id: string }).id);
        if (!found) throw new ScimError(404, "schema not found");
        return sendScim(reply, 200, found);
      });

      // ---------- Users ----------

      scim.get("/Users", HIDE, async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const { startIndex, count } = pagination(query);
        let where = "WHERE p.kind = 'human'";
        let params: string[] = [];
        if (typeof query["filter"] === "string" && query["filter"].length > 0) {
          const built = userFilterSql(query["filter"]);
          where += ` AND ${built.clause}`;
          params = built.params;
        }
        const total = await ctx.pool.query<{ count: string }>(
          `SELECT count(*) FROM principals p ${where}`,
          params
        );
        const rows = await ctx.pool.query<PrincipalRow>(
          `${USER_SELECT} ${where} GROUP BY p.id ORDER BY p.created_at
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, String(count), String(startIndex - 1)]
        );
        return sendScim(
          reply,
          200,
          listResponse(rows.rows.map(toScimUser), Number(total.rows[0]!.count), startIndex)
        );
      });

      scim.get("/Users/:id", HIDE, async (request, reply) => {
        const user = await loadUser(ctx.pool, (request.params as { id: string }).id);
        if (!user) throw new ScimError(404, "user not found");
        return sendScim(reply, 200, toScimUser(user));
      });

      scim.post("/Users", HIDE, async (request, reply) => {
        const body = (request.body ?? {}) as Record<string, unknown>;
        const userName = typeof body["userName"] === "string" ? body["userName"].trim() : "";
        if (!userName) throw new ScimError(400, "userName is required", "invalidValue");
        const externalId =
          typeof body["externalId"] === "string" && body["externalId"].length > 0
            ? body["externalId"]
            : null;
        const nameFormatted = (body["name"] as Record<string, unknown> | undefined)?.["formatted"];
        const displayName =
          (typeof body["displayName"] === "string" && body["displayName"].trim()) ||
          (typeof nameFormatted === "string" && nameFormatted.trim()) ||
          userName;
        const active = body["active"] === undefined ? true : coerceScimBool(body["active"], "active");
        const actor = actorOf(request);

        const created = await withTx(ctx.pool, async (client) => {
          const duplicate = await client.query(
            "SELECT 1 FROM principals WHERE lower(email) = lower($1)",
            [userName]
          );
          if (duplicate.rows[0]) {
            throw new ScimError(409, `a user with userName "${userName}" already exists`, "uniqueness");
          }
          if (externalId) {
            const externalDuplicate = await client.query(
              "SELECT 1 FROM principals WHERE external_id = $1",
              [externalId]
            );
            if (externalDuplicate.rows[0]) {
              throw new ScimError(409, `externalId "${externalId}" is already linked`, "uniqueness");
            }
          }
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO principals (kind, name, email, external_id, disabled_at)
             VALUES ('human', $1, $2, $3, CASE WHEN $4 THEN NULL ELSE now() END)
             RETURNING id`,
            [displayName, userName, externalId, active]
          );
          const id = inserted.rows[0]!.id;
          await appendAuditEvent(client, {
            actor,
            type: "principal.created",
            entity: { type: "principal", id },
            payload: { via: "scim", userName, externalId, active },
          });
          return (await loadUser(client, id))!;
        });
        return sendScim(reply, 201, toScimUser(created));
      });

      /** Apply attribute changes + active transitions; returns the fresh row. */
      async function applyUserChanges(
        request: FastifyRequest,
        id: string,
        changes: UserPatchChanges
      ): Promise<PrincipalRow> {
        const actor = actorOf(request);
        return withTx(ctx.pool, async (client) => {
          const user = await loadUser(client, id);
          if (!user) throw new ScimError(404, "user not found");

          const updates: string[] = [];
          const params: unknown[] = [];
          const changed: Record<string, unknown> = {};
          if (changes.userName !== undefined && changes.userName.toLowerCase() !== (user.email ?? "").toLowerCase()) {
            const clash = await client.query(
              "SELECT 1 FROM principals WHERE lower(email) = lower($1) AND id <> $2",
              [changes.userName, id]
            );
            if (clash.rows[0]) {
              throw new ScimError(409, `a user with userName "${changes.userName}" already exists`, "uniqueness");
            }
            params.push(changes.userName);
            updates.push(`email = $${params.length}`);
            changed["userName"] = changes.userName;
          }
          if (changes.displayName !== undefined && changes.displayName !== user.name) {
            params.push(changes.displayName);
            updates.push(`name = $${params.length}`);
            changed["displayName"] = changes.displayName;
          }
          if (changes.externalId !== undefined && changes.externalId !== user.external_id) {
            if (changes.externalId !== null) {
              const clash = await client.query(
                "SELECT 1 FROM principals WHERE external_id = $1 AND id <> $2",
                [changes.externalId, id]
              );
              if (clash.rows[0]) {
                throw new ScimError(409, `externalId "${changes.externalId}" is already linked`, "uniqueness");
              }
            }
            params.push(changes.externalId);
            updates.push(`external_id = $${params.length}`);
            changed["externalId"] = changes.externalId;
          }
          if (updates.length > 0) {
            params.push(id);
            await client.query(
              `UPDATE principals SET ${updates.join(", ")} WHERE id = $${params.length}`,
              params
            );
            await appendAuditEvent(client, {
              actor,
              type: "principal.updated",
              entity: { type: "principal", id },
              payload: { via: "scim", changed },
            });
          }

          const currentlyActive = user.disabled_at === null;
          if (changes.active !== undefined && changes.active !== currentlyActive) {
            if (changes.active) await reactivatePrincipal(client, id, actor, "scim");
            else await deactivatePrincipal(client, id, actor, "scim");
          }
          return (await loadUser(client, id))!;
        });
      }

      scim.put("/Users/:id", HIDE, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = (request.body ?? {}) as Record<string, unknown>;
        const changes: UserPatchChanges = {};
        if (typeof body["userName"] === "string" && body["userName"].trim().length > 0) {
          changes.userName = body["userName"].trim();
        } else {
          throw new ScimError(400, "userName is required", "invalidValue");
        }
        const nameFormatted = (body["name"] as Record<string, unknown> | undefined)?.["formatted"];
        if (typeof body["displayName"] === "string" && body["displayName"].trim()) {
          changes.displayName = body["displayName"].trim();
        } else if (typeof nameFormatted === "string" && nameFormatted.trim()) {
          changes.displayName = nameFormatted.trim();
        }
        // Omitted externalId KEEPS the stored link (lenient replace — an IdP
        // that never sends externalId must not silently unlink the account).
        if (typeof body["externalId"] === "string" && body["externalId"].length > 0) {
          changes.externalId = body["externalId"];
        }
        if (body["active"] !== undefined) changes.active = coerceScimBool(body["active"], "active");
        const user = await applyUserChanges(request, id, changes);
        return sendScim(reply, 200, toScimUser(user));
      });

      scim.patch("/Users/:id", HIDE, async (request, reply) => {
        const { id } = request.params as { id: string };
        const changes = applyUserPatch(parsePatchBody(request.body));
        const user = await applyUserChanges(request, id, changes);
        return sendScim(reply, 200, toScimUser(user));
      });

      scim.delete("/Users/:id", HIDE, async (request, reply) => {
        const { id } = request.params as { id: string };
        const actor = actorOf(request);
        await withTx(ctx.pool, async (client) => {
          const user = await loadUser(client, id);
          if (!user) throw new ScimError(404, "user not found");
          await deactivatePrincipal(client, id, actor, "scim");
        });
        return sendScim(reply, 204);
      });

      // ---------- Groups (the six fixed roles) ----------

      interface MemberRow {
        id: string;
        name: string;
      }

      async function groupMembers(db: pg.Pool | pg.ClientBase, role: Role): Promise<MemberRow[]> {
        const result = await db.query<MemberRow>(
          `SELECT p.id, p.name FROM role_assignments r
           JOIN principals p ON p.id = r.principal_id
           WHERE r.role = $1 AND p.kind = 'human'
           ORDER BY p.created_at`,
          [role]
        );
        return result.rows;
      }

      function toScimGroup(role: Role, members: MemberRow[] | null) {
        const group = ROLE_GROUPS.find((g) => g.id === role)!;
        return {
          schemas: [SCIM_URN.group],
          id: group.id,
          displayName: group.displayName,
          ...(members
            ? {
                members: members.map((m) => ({
                  value: m.id,
                  display: m.name,
                  $ref: `${BASE_PATH}/Users/${m.id}`,
                })),
              }
            : {}),
          meta: { resourceType: "Group", location: `${BASE_PATH}/Groups/${group.id}` },
        };
      }

      function roleOf(id: string): Role {
        const group = ROLE_GROUPS.find((g) => g.id === id);
        if (!group) throw new ScimError(404, "group not found");
        return group.id;
      }

      scim.get("/Groups", HIDE, async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const { startIndex, count } = pagination(query);
        const excludeMembers =
          typeof query["excludedAttributes"] === "string" &&
          query["excludedAttributes"]
            .split(",")
            .map((a) => a.trim().toLowerCase())
            .includes("members");
        let groups = [...ROLE_GROUPS];
        if (typeof query["filter"] === "string" && query["filter"].length > 0) {
          const parsed = parseFilter(query["filter"]);
          if (parsed.attr !== "displayname" || parsed.op !== "eq") {
            throw new ScimError(400, "groups support only: displayName eq \"...\"", "invalidFilter");
          }
          groups = groups.filter(
            (g) => g.displayName.toLowerCase() === parsed.value.toLowerCase()
          );
        }
        const page = groups.slice(startIndex - 1, startIndex - 1 + count);
        const resources = await Promise.all(
          page.map(async (g) =>
            toScimGroup(g.id, excludeMembers ? null : await groupMembers(ctx.pool, g.id))
          )
        );
        return sendScim(reply, 200, listResponse(resources, groups.length, startIndex));
      });

      scim.get("/Groups/:id", HIDE, async (request, reply) => {
        const role = roleOf((request.params as { id: string }).id);
        return sendScim(reply, 200, toScimGroup(role, await groupMembers(ctx.pool, role)));
      });

      async function grantRole(
        client: pg.ClientBase,
        role: Role,
        memberId: string,
        actor: AuditActor
      ): Promise<void> {
        if (!UUID_RE.test(memberId)) {
          throw new ScimError(400, `no such user: ${memberId}`, "invalidValue");
        }
        const target = await client.query<{ kind: string }>(
          "SELECT kind FROM principals WHERE id = $1",
          [memberId]
        );
        if (!target.rows[0] || target.rows[0].kind !== "human") {
          // agents are not SCIM-managed — same answer as a missing user
          throw new ScimError(400, `no such user: ${memberId}`, "invalidValue");
        }
        const inserted = await client.query(
          `INSERT INTO role_assignments (principal_id, role) VALUES ($1, $2)
           ON CONFLICT (principal_id, role) DO NOTHING`,
          [memberId, role]
        );
        if ((inserted.rowCount ?? 0) > 0) {
          await appendAuditEvent(client, {
            actor,
            type: "role.granted",
            entity: { type: "principal", id: memberId },
            payload: { role, via: "scim" },
          });
        }
      }

      async function revokeRole(
        client: pg.ClientBase,
        role: Role,
        memberId: string,
        actor: AuditActor
      ): Promise<void> {
        if (!UUID_RE.test(memberId)) return;
        if (role === "admin") {
          await assertNotLastAdmin(client, memberId, "remove the admin role from");
        }
        const deleted = await client.query(
          "DELETE FROM role_assignments WHERE principal_id = $1 AND role = $2",
          [memberId, role]
        );
        if ((deleted.rowCount ?? 0) > 0) {
          await appendAuditEvent(client, {
            actor,
            type: "role.revoked",
            entity: { type: "principal", id: memberId },
            payload: { role, via: "scim" },
          });
        }
      }

      async function applyMembership(
        request: FastifyRequest,
        role: Role,
        actions: ReturnType<typeof applyGroupPatch>
      ): Promise<MemberRow[]> {
        const actor = actorOf(request);
        return withTx(ctx.pool, async (client) => {
          for (const action of actions) {
            if (action.kind === "add") {
              for (const id of action.ids) await grantRole(client, role, id, actor);
            } else if (action.kind === "remove") {
              for (const id of action.ids) await revokeRole(client, role, id, actor);
            } else if (action.kind === "removeAll") {
              const members = await groupMembers(client, role);
              for (const member of members) await revokeRole(client, role, member.id, actor);
            } else {
              const wanted = new Set(action.ids);
              const current = await groupMembers(client, role);
              const held = new Set(current.map((m) => m.id));
              // adds BEFORE removes, so replacing the admin set never
              // passes through a zero-admin state.
              for (const id of action.ids) {
                if (!held.has(id)) await grantRole(client, role, id, actor);
              }
              for (const member of current) {
                if (!wanted.has(member.id)) await revokeRole(client, role, member.id, actor);
              }
            }
          }
          return groupMembers(client, role);
        });
      }

      scim.patch("/Groups/:id", HIDE, async (request, reply) => {
        const role = roleOf((request.params as { id: string }).id);
        const actions = applyGroupPatch(parsePatchBody(request.body));
        const members = await applyMembership(request, role, actions);
        return sendScim(reply, 200, toScimGroup(role, members));
      });

      scim.put("/Groups/:id", HIDE, async (request, reply) => {
        const role = roleOf((request.params as { id: string }).id);
        const body = (request.body ?? {}) as Record<string, unknown>;
        const raw = body["members"] ?? [];
        if (!Array.isArray(raw)) {
          throw new ScimError(400, "members must be an array", "invalidValue");
        }
        const ids = raw.map((entry) => {
          const value = (entry as { value?: unknown })?.value;
          if (typeof value !== "string") {
            throw new ScimError(400, "each member must carry a string `value`", "invalidValue");
          }
          return value;
        });
        const members = await applyMembership(request, role, [{ kind: "replace", ids }]);
        return sendScim(reply, 200, toScimGroup(role, members));
      });
    },
    { prefix: BASE_PATH }
  );
}
