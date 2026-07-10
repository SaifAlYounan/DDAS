/**
 * SCIM 2.0 protocol plumbing (RFC 7643/7644), pure and unit-tested:
 * the error type, the filter parser, and the PATCH Operations parser.
 *
 * Deliberate subset — what Okta and Entra actually send:
 * - filter: `<attr> eq "value"` (plus `sw` on userName), attr ∈
 *   userName / externalId / displayName / emails.value.
 * - PATCH: add / replace / remove; paths are simple attributes
 *   (`active`, `userName`, `name.formatted`, …) or the members forms
 *   `members` and `members[value eq "<id>"]`. Multi-valued filters on
 *   other attributes are rejected as invalidPath.
 * - Unsupported/unknown USER attributes are ignored per RFC 7644 §3.5.2
 *   ("Service providers MAY ignore unsupported attributes").
 * - Entra quirk: boolean `active` arrives as the strings "True"/"False".
 */

export const SCIM_URN = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  listResponse: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patchOp: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
  serviceProviderConfig: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  resourceType: "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
  schema: "urn:ietf:params:scim:schemas:core:2.0:Schema",
} as const;

/** RFC 7644 §3.12 error — carried to the client as the SCIM error envelope. */
export class ScimError extends Error {
  readonly status: number;
  readonly scimType: string | undefined;

  constructor(status: number, detail: string, scimType?: string) {
    super(detail);
    this.name = "ScimError";
    this.status = status;
    this.scimType = scimType;
  }
}

export function scimErrorBody(status: number, detail: string, scimType?: string) {
  return {
    schemas: [SCIM_URN.error],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  };
}

// ---------- filter ----------

export interface ScimFilter {
  /** lowercased attribute path, e.g. "username", "externalid", "emails.value" */
  attr: string;
  op: "eq" | "sw";
  value: string;
}

const FILTER_RE = /^\s*([A-Za-z][A-Za-z0-9$_]*(?:\.[A-Za-z][A-Za-z0-9$_]*)?)\s+(eq|sw)\s+"((?:[^"\\]|\\.)*)"\s*$/i;

function unescapeScimString(raw: string): string {
  return raw.replace(/\\(.)/g, (_, c: string) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    return c; // \" \\ / and anything else: the literal character
  });
}

/** Parse the supported filter grammar; throw 400 invalidFilter otherwise. */
export function parseFilter(filter: string): ScimFilter {
  const match = FILTER_RE.exec(filter);
  if (!match) {
    throw new ScimError(400, `unsupported filter: ${filter}`, "invalidFilter");
  }
  return {
    attr: match[1]!.toLowerCase(),
    op: match[2]!.toLowerCase() as "eq" | "sw",
    value: unescapeScimString(match[3]!),
  };
}

// ---------- PATCH ----------

export interface ScimPatchPath {
  /** lowercased first segment, e.g. "members", "name", "active" */
  attr: string;
  /** lowercased sub-attribute, e.g. "formatted" for name.formatted */
  sub?: string;
  /** value filter inside [...], e.g. members[value eq "id"] */
  filter?: ScimFilter;
}

export interface ScimPatchOp {
  op: "add" | "replace" | "remove";
  path?: ScimPatchPath;
  value?: unknown;
}

const PATH_RE = /^([A-Za-z][A-Za-z0-9$_]*)(?:\[([^\]]+)\])?(?:\.([A-Za-z][A-Za-z0-9$_]*))?$/;

export function parsePatchPath(path: string): ScimPatchPath {
  // Strip an optional schema-URN prefix (Entra sends fully-qualified paths).
  const bare = path.startsWith("urn:") ? path.slice(path.lastIndexOf(":") + 1) : path;
  const match = PATH_RE.exec(bare.trim());
  if (!match) throw new ScimError(400, `unsupported path: ${path}`, "invalidPath");
  const parsed: ScimPatchPath = { attr: match[1]!.toLowerCase() };
  if (match[3]) parsed.sub = match[3].toLowerCase();
  if (match[2]) parsed.filter = parseFilter(match[2]);
  return parsed;
}

/** Parse a PATCH request body into normalized operations. */
export function parsePatchBody(body: unknown): ScimPatchOp[] {
  const record = body as { schemas?: unknown; Operations?: unknown; operations?: unknown };
  if (typeof body !== "object" || body === null) {
    throw new ScimError(400, "PATCH body must be a JSON object", "invalidSyntax");
  }
  const schemas = Array.isArray(record.schemas) ? (record.schemas as unknown[]) : [];
  if (!schemas.includes(SCIM_URN.patchOp)) {
    throw new ScimError(400, `PATCH body must declare schema ${SCIM_URN.patchOp}`, "invalidSyntax");
  }
  const rawOps = record.Operations ?? record.operations;
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    throw new ScimError(400, "PATCH body must carry a non-empty Operations array", "invalidSyntax");
  }
  return rawOps.map((raw) => {
    const entry = raw as { op?: unknown; path?: unknown; value?: unknown };
    const op = typeof entry.op === "string" ? entry.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") {
      throw new ScimError(400, `unsupported PATCH op: ${String(entry.op)}`, "invalidSyntax");
    }
    const parsed: ScimPatchOp = { op };
    if (entry.path !== undefined) {
      if (typeof entry.path !== "string") {
        throw new ScimError(400, "PATCH path must be a string", "invalidPath");
      }
      parsed.path = parsePatchPath(entry.path);
    } else if (op === "remove") {
      throw new ScimError(400, 'PATCH "remove" requires a path', "noTarget");
    }
    if (entry.value !== undefined) parsed.value = entry.value;
    return parsed;
  });
}

/** Entra sends active as "True"/"False" strings; accept those and booleans. */
export function coerceScimBool(value: unknown, attr: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  throw new ScimError(400, `${attr} must be a boolean`, "invalidValue");
}

// ---------- applying PATCH to a User ----------

/** The writable User attributes DDAS maps onto a principal. */
export interface UserPatchChanges {
  userName?: string;
  displayName?: string;
  /** null = clear */
  externalId?: string | null;
  active?: boolean;
}

function asNonEmptyString(value: unknown, attr: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ScimError(400, `${attr} must be a non-empty string`, "invalidValue");
  }
  return value.trim();
}

function applyUserAttr(changes: UserPatchChanges, attr: string, value: unknown): void {
  switch (attr) {
    case "username":
      changes.userName = asNonEmptyString(value, "userName");
      return;
    case "displayname":
      changes.displayName = asNonEmptyString(value, "displayName");
      return;
    case "externalid":
      changes.externalId = value === null ? null : asNonEmptyString(value, "externalId");
      return;
    case "active":
      changes.active = coerceScimBool(value, "active");
      return;
    default:
      return; // unsupported attribute — ignored (RFC 7644 §3.5.2)
  }
}

/**
 * Reduce parsed PATCH ops to the attribute changes DDAS supports.
 * add/replace are equivalent for single-valued attributes; remove clears
 * externalId/displayName and is rejected for required attributes.
 */
export function applyUserPatch(ops: ScimPatchOp[]): UserPatchChanges {
  const changes: UserPatchChanges = {};
  for (const operation of ops) {
    if (operation.op === "remove") {
      const attr = operation.path!.attr + (operation.path!.sub ? `.${operation.path!.sub}` : "");
      if (attr === "externalid") changes.externalId = null;
      else if (attr === "username" || attr === "active") {
        throw new ScimError(400, `${attr} cannot be removed`, "mutability");
      }
      // anything else: ignored
      continue;
    }
    if (operation.path) {
      const { attr, sub } = operation.path;
      if (operation.path.filter) {
        throw new ScimError(400, "value filters are only supported on group members", "invalidPath");
      }
      if (attr === "name" && sub === "formatted") {
        changes.displayName = asNonEmptyString(operation.value, "name.formatted");
      } else if (sub === undefined) {
        applyUserAttr(changes, attr, operation.value);
      } else if (attr === "name") {
        // name.givenName / name.familyName — unsupported sub-attrs, ignored
      }
      continue;
    }
    // No path: value is an object of attributes to merge.
    if (typeof operation.value !== "object" || operation.value === null) {
      throw new ScimError(400, "PATCH without a path requires an object value", "invalidValue");
    }
    for (const [key, value] of Object.entries(operation.value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (lowered === "name" && typeof value === "object" && value !== null) {
        const formatted = (value as Record<string, unknown>)["formatted"];
        if (formatted !== undefined) {
          changes.displayName = asNonEmptyString(formatted, "name.formatted");
        }
        continue;
      }
      applyUserAttr(changes, lowered, value);
    }
  }
  return changes;
}

// ---------- applying PATCH to a Group ----------

export type GroupMembershipAction =
  | { kind: "add"; ids: string[] }
  | { kind: "remove"; ids: string[] }
  | { kind: "removeAll" }
  | { kind: "replace"; ids: string[] };

function memberIds(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    if (typeof entry === "string") return entry;
    const id = (entry as { value?: unknown })?.value;
    if (typeof id !== "string" || id.length === 0) {
      throw new ScimError(400, "each member must carry a string `value` (the user id)", "invalidValue");
    }
    return id;
  });
}

/**
 * Reduce parsed PATCH ops on a Group to membership actions. Supports:
 * add/replace/remove on path "members", remove on `members[value eq "id"]`,
 * and the no-path form `{ members: [...] }`. displayName is immutable
 * (groups ARE the six fixed roles).
 */
export function applyGroupPatch(ops: ScimPatchOp[]): GroupMembershipAction[] {
  const actions: GroupMembershipAction[] = [];
  for (const operation of ops) {
    const path = operation.path;
    let value = operation.value;
    let attr = path?.attr;
    if (!path) {
      // No path: expect { members: [...] } (Okta/Entra never send more here).
      const record = operation.value as Record<string, unknown> | null;
      const key = record ? Object.keys(record).find((k) => k.toLowerCase() === "members") : undefined;
      if (!key) continue; // nothing we manage — ignore
      attr = "members";
      value = (record as Record<string, unknown>)[key];
    }
    if (attr !== "members") {
      if (attr === "displayname") {
        throw new ScimError(400, "group displayName is immutable — groups are the fixed DDAS roles", "mutability");
      }
      continue; // unsupported group attribute — ignored
    }
    if (operation.op === "remove") {
      if (path?.filter) {
        if (path.filter.attr !== "value" || path.filter.op !== "eq") {
          throw new ScimError(400, "only members[value eq \"...\"] is supported", "invalidPath");
        }
        actions.push({ kind: "remove", ids: [path.filter.value] });
      } else if (value !== undefined) {
        actions.push({ kind: "remove", ids: memberIds(value) });
      } else {
        actions.push({ kind: "removeAll" });
      }
      continue;
    }
    if (path?.filter) {
      throw new ScimError(400, "value filters are only supported with remove", "invalidPath");
    }
    actions.push({ kind: operation.op === "add" ? "add" : "replace", ids: memberIds(value) });
  }
  return actions;
}
