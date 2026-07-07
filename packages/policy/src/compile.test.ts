/**
 * Compiler + linter: starter-balanced must compile clean (zero errors), the
 * hash must be canonical, and each semantic check must catch its mutation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { compileDocument, compilePolicy, lintPolicy, PolicyCompileError } from "./compile.js";
import type { RiskPolicyV1 } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const yamlSource = readFileSync(join(here, "../templates/starter-balanced.yaml"), "utf8");
const template = parseYaml(yamlSource) as RiskPolicyV1;

const mutate = (fn: (d: RiskPolicyV1) => void): RiskPolicyV1 => {
  const d = structuredClone(template);
  fn(d);
  return d;
};

const errorsOf = (d: RiskPolicyV1) => lintPolicy(d).filter((f) => f.severity === "error");

describe("compilePolicy on starter-balanced", () => {
  it("lints clean (zero errors) verbatim", () => {
    expect(errorsOf(template)).toEqual([]);
  });

  it("compiles with a stable canonical hash", () => {
    const a = compilePolicy(yamlSource);
    const b = compilePolicy(yamlSource);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // key order must not matter
    const reordered = Object.fromEntries(Object.entries(structuredClone(template)).reverse());
    expect(compileDocument(reordered).contentHash).toBe(a.contentHash);
  });

  it("builds integer-only indices", () => {
    const { compiled } = compilePolicy(yamlSource);
    expect(compiled.maxTier).toBe(4);
    expect(compiled.ratings).toEqual(["Low", "Moderate", "High", "Critical"]);
    const financial = compiled.categories[0]!;
    expect(financial.id).toBe("financial");
    expect(financial.matrix.every((row) => row.every((c) => Number.isInteger(c)))).toBe(true);
    expect(financial.appetite).toEqual([0, 1, 3, 4]);
    expect(financial.agentAppetite).toEqual([1, 2, 4, 4]);
    expect(financial.bands.at(-1)!.ast).toEqual({ kind: "else" });
    expect(compiled.triggers.map((t) => t.id)).toEqual(["sanctions_exposure", "uncapped_liability", "novel_precedent"]);
    expect(compiled.agent.attestationFactIdxs).toEqual([compiled.factIdxById["counterparty_name"]]);
    expect(compiled.fx?.base).toBe("EUR");
  });

  it("compileDocument rejects schema-invalid input with findings", () => {
    expect(() => compileDocument({ schema_version: 1 })).toThrow(PolicyCompileError);
  });
});

describe("semantic lint mutations (one per check)", () => {
  const cases: Array<[string, (d: RiskPolicyV1) => void, RegExp]> = [
    ["non-contiguous ladder", (d) => (d.authority_ladder[1]!.tier = 5), /contiguous/],
    ["duplicate tier names", (d) => (d.authority_ladder[1]!.name = d.authority_ladder[0]!.name), /unique/],
    ["appetite missing a rating", (d) => delete (d.categories[0]!.appetite as Record<string, number>)["High"], /missing ratings: High/],
    ["appetite unknown rating", (d) => ((d.categories[0]!.appetite as Record<string, number>)["Apocalyptic"] = 4), /unknown ratings/],
    ["appetite non-monotone", (d) => ((d.categories[0]!.appetite as Record<string, number>)["Critical"] = 0), /non-decreasing/],
    ["appetite tier out of range", (d) => ((d.categories[0]!.appetite as Record<string, number>)["Critical"] = 9), /outside ladder/],
    ["agent appetite below default", (d) => ((d.categories[0]!.appetite_agent_initiated as Record<string, number>)["High"] = 1), /must be >= default/],
    ["matrix missing row", (d) => delete d.categories[0]!.risk_matrix["Minor"], /missing rows/],
    ["matrix extra row", (d) => (d.categories[0]!.risk_matrix["Phantom"] = ["Low", "Low", "Low", "Low", "Low"]), /undeclared impact bands/],
    ["matrix wrong row length", (d) => (d.categories[0]!.risk_matrix["Minor"] = ["Low", "Low"]), /expected 5 cells/],
    ["matrix unknown rating", (d) => (d.categories[0]!.risk_matrix["Minor"]![0] = "Sideways"), /unknown rating/],
    ["matrix non-monotone in likelihood", (d) => (d.categories[0]!.risk_matrix["Minor"] = ["Moderate", "Low", "Low", "Moderate", "Moderate"]), /non-decreasing along likelihood/],
    ["matrix non-monotone in impact", (d) => (d.categories[0]!.risk_matrix["Severe"] = ["Low", "Low", "Low", "Low", "Low"]), /non-decreasing with impact severity/],
    ["band rule parse error", (d) => (d.categories[0]!.impact_scale.bands[0]!.rule = "amount_base_total <"), /expected operand/],
    ["band rule unknown fact", (d) => (d.categories[0]!.impact_scale.bands[0]!.rule = "total_amount_x < 5"), /not declared/],
    ["band rule type mismatch", (d) => (d.categories[0]!.impact_scale.bands[0]!.rule = "amount_base_total < 'cheap'"), /numeric/],
    ["no else band", (d) => (d.categories[0]!.impact_scale.bands.at(-1)!.rule = "amount_base_total >= 2000000"), /exactly one 'else'/],
    ["else not last", (d) => (d.categories[0]!.impact_scale.bands[0]!.rule = "else"), /must be last/],
    ["duplicate band names", (d) => (d.categories[0]!.impact_scale.bands[1]!.name = "Minor"), /band names must be unique/],
    ["required fact unknown", (d) => d.categories[0]!.impact_scale.required_facts!.push("ghost_fact"), /unknown fact 'ghost_fact'/],
    ["likelihood default missing", (d) => (d.categories[0]!.likelihood_rules = [{ if: "cross_border == true", min_band: "Possible" }]), /exactly one \{default_band\}/],
    ["likelihood unknown band", (d) => (d.categories[0]!.likelihood_rules = [{ default_band: "Inevitable" }]), /unknown likelihood band/],
    ["likelihood else forbidden", (d) => (d.categories[0]!.likelihood_rules = [{ if: "else", min_band: "Possible" }, { default_band: "Unlikely" }]), /'else' is not allowed/],
    ["conservative band unknown", (d) => (d.categories[0]!.missing_info = { behavior: "escalate", conservative_band: "Cataclysmic" }), /not an impact band/],
    ["duplicate trigger ids", (d) => (d.escalation_triggers![1]!.id = d.escalation_triggers![0]!.id), /trigger ids must be unique/],
    ["trigger rule else", (d) => (d.escalation_triggers![0]!.rule = "else"), /'else' is not allowed in triggers/],
    ["trigger min_tier out of range", (d) => (d.escalation_triggers![0]!.min_tier = 12), /outside ladder/],
    ["accumulation unknown rating", (d) => (d.accumulation_rule!.count_at_or_above = "Enormous"), /unknown rating/],
    ["attestation fact unknown", (d) => d.agent_policy.attestation_required_facts!.push("phantom"), /unknown fact 'phantom'/],
    ["money fact without fx", (d) => delete d.fx_snapshot, /must pin an fx_snapshot/],
    ["money fact non-base unit", (d) => (d.fact_schema[0]!.unit = "USD"), /base currency/],
    ["NOT_FOUND with ordinal op", (d) => (d.categories[0]!.impact_scale.bands[0]!.rule = "amount_base_total < NOT_FOUND"), /NOT_FOUND/],
    ["duplicate fact ids", (d) => (d.fact_schema[1]!.id = d.fact_schema[0]!.id), /fact ids must be unique/],
    ["duplicate category ids", (d) => (d.categories[1]!.id = d.categories[0]!.id), /category ids must be unique/],
  ];

  it.each(cases)("catches: %s", (_name, fn, pattern) => {
    const errors = errorsOf(mutate(fn));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((e) => `${e.path}: ${e.message}`).join("\n")).toMatch(pattern);
  });

  it("emits warnings without blocking (unused list, never-firing accumulation)", () => {
    const d = mutate((doc) => (doc.accumulation_rule!.threshold = 99));
    const findings = lintPolicy(d);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(findings.some((f) => f.message.includes("can never fire"))).toBe(true);
    expect(findings.some((f) => f.path === "reference_lists.home_jurisdictions")).toBe(true);
  });
});
