/**
 * ADR 0005 invariants, unit level: catalog shape, built-in immutability at
 * the type/value level, union/additivity of the resolver, and the
 * fail-closed handling of unknown stored permissions.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_ROLE_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  PERMISSIONS,
  isAdminPermission,
  isKnownPermission,
  resolvePermissions,
} from "./permissions.js";

describe("permission catalog", () => {
  it("is closed, unique, and dot-namespaced", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("grantable = catalog minus admin.*", () => {
    expect(GRANTABLE_PERMISSIONS.every((p) => !isAdminPermission(p))).toBe(true);
    expect(PERMISSIONS.filter(isAdminPermission).length).toBeGreaterThan(0);
    expect(GRANTABLE_PERMISSIONS.length + PERMISSIONS.filter(isAdminPermission).length).toBe(
      PERMISSIONS.length
    );
  });

  it("every built-in set draws only from the catalog; admin holds ALL of it", () => {
    for (const set of Object.values(BUILTIN_ROLE_PERMISSIONS)) {
      for (const permission of set) expect(isKnownPermission(permission)).toBe(true);
    }
    expect(new Set(BUILTIN_ROLE_PERMISSIONS.admin)).toEqual(new Set(PERMISSIONS));
  });

  it("only admin holds admin.* — the built-in sets keep the plane exclusive", () => {
    for (const [role, set] of Object.entries(BUILTIN_ROLE_PERMISSIONS)) {
      if (role === "admin") continue;
      expect(set.some(isAdminPermission), role).toBe(false);
    }
  });

  it("requester does NOT hold facts.attest (multi-tenant confinement)", () => {
    expect(BUILTIN_ROLE_PERMISSIONS.requester).not.toContain("facts.attest");
    expect(BUILTIN_ROLE_PERMISSIONS.viewer).toEqual(["requests.read"]);
  });
});

describe("resolvePermissions", () => {
  it("unions built-in sets with stored custom grants (additive, order-independent)", () => {
    const a = resolvePermissions(["viewer"], ["facts.attest"]);
    const b = resolvePermissions(["viewer"], []);
    expect(a.has("requests.read")).toBe(true);
    expect(a.has("facts.attest")).toBe(true);
    // additivity: the custom grant only ever ADDS
    for (const permission of b) expect(a.has(permission)).toBe(true);
    // order independence
    const c = resolvePermissions(["auditor", "requester"], []);
    const d = resolvePermissions(["requester", "auditor"], []);
    expect(c).toEqual(d);
  });

  it("no roles + no grants = empty set (deny-by-default)", () => {
    expect(resolvePermissions([], []).size).toBe(0);
  });

  it("ignores and reports unknown stored permissions — fail-closed", () => {
    const unknown: string[] = [];
    const resolved = resolvePermissions(
      [],
      ["requests.read", "future.shiny", "admin.everything"],
      (permission) => unknown.push(permission)
    );
    expect(resolved.has("requests.read")).toBe(true);
    expect(resolved.size).toBe(1);
    expect(unknown.sort()).toEqual(["admin.everything", "future.shiny"]);
  });

  it("ignores unknown role names rather than throwing (stale enum tolerant)", () => {
    const resolved = resolvePermissions(["ghost_role", "viewer"], []);
    expect(resolved).toEqual(new Set(["requests.read"]));
  });
});
