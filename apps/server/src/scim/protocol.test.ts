import { describe, expect, it } from "vitest";
import {
  applyGroupPatch,
  applyUserPatch,
  coerceScimBool,
  parseFilter,
  parsePatchBody,
  parsePatchPath,
  ScimError,
  SCIM_URN,
} from "./protocol.js";

function patchBody(operations: unknown[]): unknown {
  return { schemas: [SCIM_URN.patchOp], Operations: operations };
}

describe("SCIM filter parser", () => {
  it("parses userName eq", () => {
    expect(parseFilter('userName eq "ruben@kolvarra.test"')).toEqual({
      attr: "username",
      op: "eq",
      value: "ruben@kolvarra.test",
    });
  });

  it("parses sw and sub-attribute paths, case-insensitively", () => {
    expect(parseFilter('userName sw "ruben"')).toMatchObject({ op: "sw" });
    expect(parseFilter('emails.value EQ "x@y.z"')).toEqual({
      attr: "emails.value",
      op: "eq",
      value: "x@y.z",
    });
  });

  it("unescapes quoted strings", () => {
    expect(parseFilter('displayName eq "say \\"hi\\" \\\\ ok"').value).toBe('say "hi" \\ ok');
  });

  it("rejects unsupported grammar as invalidFilter", () => {
    for (const bad of [
      'userName co "x"',
      'userName eq "a" and active eq true',
      "userName eq unquoted",
      "",
    ]) {
      expect(() => parseFilter(bad)).toThrowError(ScimError);
      try {
        parseFilter(bad);
      } catch (err) {
        expect((err as ScimError).scimType).toBe("invalidFilter");
        expect((err as ScimError).status).toBe(400);
      }
    }
  });
});

describe("SCIM PATCH path parser", () => {
  it("parses simple, dotted, and filtered paths", () => {
    expect(parsePatchPath("active")).toEqual({ attr: "active" });
    expect(parsePatchPath("name.formatted")).toEqual({ attr: "name", sub: "formatted" });
    expect(parsePatchPath('members[value eq "abc-123"]')).toEqual({
      attr: "members",
      filter: { attr: "value", op: "eq", value: "abc-123" },
    });
  });

  it("strips a urn prefix (Entra fully-qualified paths)", () => {
    expect(parsePatchPath("urn:ietf:params:scim:schemas:core:2.0:User:userName")).toEqual({
      attr: "username",
    });
  });

  it("rejects garbage paths as invalidPath", () => {
    expect(() => parsePatchPath("members[")).toThrowError(ScimError);
    expect(() => parsePatchPath("a b c")).toThrowError(ScimError);
  });
});

describe("SCIM PATCH body parser", () => {
  it("requires the PatchOp schema urn and a non-empty Operations array", () => {
    expect(() => parsePatchBody({ Operations: [{ op: "add" }] })).toThrowError(ScimError);
    expect(() => parsePatchBody(patchBody([]))).toThrowError(ScimError);
    expect(() => parsePatchBody(null)).toThrowError(ScimError);
  });

  it("normalizes op case (Entra sends Replace/Add/Remove)", () => {
    const ops = parsePatchBody(
      patchBody([{ op: "Replace", path: "active", value: false }])
    );
    expect(ops[0]).toMatchObject({ op: "replace", path: { attr: "active" }, value: false });
  });

  it("rejects unknown ops and pathless removes", () => {
    expect(() => parsePatchBody(patchBody([{ op: "move", path: "x" }]))).toThrowError(ScimError);
    expect(() => parsePatchBody(patchBody([{ op: "remove" }]))).toThrowError(ScimError);
  });
});

describe("applyUserPatch", () => {
  it("handles replace-with-path for each supported attribute", () => {
    const changes = applyUserPatch(
      parsePatchBody(
        patchBody([
          { op: "replace", path: "userName", value: "new@kolvarra.test" },
          { op: "replace", path: "displayName", value: "New Name" },
          { op: "replace", path: "externalId", value: "okta-42" },
          { op: "replace", path: "active", value: false },
        ])
      )
    );
    expect(changes).toEqual({
      userName: "new@kolvarra.test",
      displayName: "New Name",
      externalId: "okta-42",
      active: false,
    });
  });

  it("handles the pathless value-object form and name.formatted", () => {
    const changes = applyUserPatch(
      parsePatchBody(
        patchBody([
          { op: "add", value: { userName: "a@b.c", name: { formatted: "A B" }, active: "True" } },
        ])
      )
    );
    expect(changes).toEqual({ userName: "a@b.c", displayName: "A B", active: true });
  });

  it("coerces Entra's string booleans on active", () => {
    expect(
      applyUserPatch(parsePatchBody(patchBody([{ op: "replace", path: "active", value: "False" }])))
    ).toEqual({ active: false });
    expect(coerceScimBool("true", "active")).toBe(true);
    expect(() => coerceScimBool("yes", "active")).toThrowError(ScimError);
  });

  it("ignores unsupported attributes (RFC 7644 §3.5.2) but rejects removing required ones", () => {
    expect(
      applyUserPatch(
        parsePatchBody(
          patchBody([
            { op: "replace", path: "title", value: "CFO" },
            { op: "replace", path: "name.givenName", value: "Ruben" },
            { op: "remove", path: "externalId" },
          ])
        )
      )
    ).toEqual({ externalId: null });
    expect(() =>
      applyUserPatch(parsePatchBody(patchBody([{ op: "remove", path: "userName" }])))
    ).toThrowError(/cannot be removed/);
  });
});

describe("applyGroupPatch", () => {
  it("maps add/remove/replace member ops", () => {
    const actions = applyGroupPatch(
      parsePatchBody(
        patchBody([
          { op: "add", path: "members", value: [{ value: "id-1" }, { value: "id-2" }] },
          { op: "remove", path: 'members[value eq "id-3"]' },
          { op: "replace", path: "members", value: [{ value: "id-4" }] },
        ])
      )
    );
    expect(actions).toEqual([
      { kind: "add", ids: ["id-1", "id-2"] },
      { kind: "remove", ids: ["id-3"] },
      { kind: "replace", ids: ["id-4"] },
    ]);
  });

  it("supports remove-all, pathless member values, and remove-with-value", () => {
    expect(applyGroupPatch(parsePatchBody(patchBody([{ op: "remove", path: "members" }])))).toEqual(
      [{ kind: "removeAll" }]
    );
    expect(
      applyGroupPatch(
        parsePatchBody(patchBody([{ op: "add", value: { members: [{ value: "id-9" }] } }]))
      )
    ).toEqual([{ kind: "add", ids: ["id-9"] }]);
    expect(
      applyGroupPatch(
        parsePatchBody(
          patchBody([{ op: "remove", path: "members", value: [{ value: "id-7" }] }])
        )
      )
    ).toEqual([{ kind: "remove", ids: ["id-7"] }]);
  });

  it("refuses renaming a group — groups are the fixed roles", () => {
    expect(() =>
      applyGroupPatch(
        parsePatchBody(patchBody([{ op: "replace", path: "displayName", value: "Renamed" }]))
      )
    ).toThrowError(/immutable/);
  });

  it("rejects member entries without a value", () => {
    expect(() =>
      applyGroupPatch(
        parsePatchBody(patchBody([{ op: "add", path: "members", value: [{ display: "x" }] }]))
      )
    ).toThrowError(ScimError);
  });
});
