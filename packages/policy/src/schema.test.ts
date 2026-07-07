/**
 * Phase 0 executable spec: the published JSON Schema and the starter template
 * must agree — the template is the schema's canonical example.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(here, "../schema/policy.v1.schema.json"), "utf8")
);
const template = parse(
  readFileSync(join(here, "../templates/starter-balanced.yaml"), "utf8")
);

const ajv = new Ajv2020.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validate = ajv.compile(schema);

describe("policy schema v1", () => {
  it("accepts the starter-balanced template", () => {
    const valid = validate(template);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("rejects a policy without categories", () => {
    const { categories: _dropped, ...rest } = template as Record<string, unknown>;
    expect(validate(rest)).toBe(false);
  });

  it("rejects an escalate missing-info policy without a conservative band", () => {
    const broken = structuredClone(template);
    broken.categories[0].missing_info = { behavior: "escalate" };
    expect(validate(broken)).toBe(false);
  });

  it("rejects unknown top-level keys (no silent policy drift)", () => {
    const broken = structuredClone(template);
    broken.gu_weights = { financial: 0.25 };
    expect(validate(broken)).toBe(false);
  });
});
