/**
 * End-to-end engine behavior against the starter-balanced policy — one test
 * per interesting ACOS path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDocument, compilePolicy } from "@ddas/policy";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { classify } from "./classify.js";
import type { Fact, FactSet, Subject } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const yamlSource = readFileSync(join(here, "../../policy/templates/starter-balanced.yaml"), "utf8");
const policy = compilePolicy(yamlSource);

const HUMAN: Subject = { initiatorKind: "human", initiator: "user:j.doe", actionType: "vendor_contract_renewal" };
const AGENT: Subject = {
  initiatorKind: "agent",
  initiator: "agent:procure-bot-3",
  onBehalfOf: "user:j.doe",
  actionType: "vendor_contract_renewal",
};
const DOCS = [{ name: "msa.md", sha256: "0".repeat(64) }];

const found = (id: string, value: Fact["value"], unit?: string): Fact =>
  ({
    id,
    status: "FOUND",
    value,
    ...(unit ? { unit } : {}),
    citation: { docIndex: 0, span: [0, 10], text: "cited span" },
  }) as Fact;

const notFound = (id: string): Fact => ({ id, status: "NOT_FOUND" }) as Fact;

/** A fully-known, low-risk baseline; override per case. */
function facts(overrides: Record<string, Fact | null> = {}): FactSet {
  const base: Record<string, Fact> = {
    amount_base_total: found("amount_base_total", 5000, "EUR"),
    action_type: found("action_type", "vendor_contract_renewal"),
    counterparty_name: { id: "counterparty_name", status: "MANUAL", value: "Acme GmbH", attestedBy: "user:j.doe" },
    counterparty_jurisdiction: found("counterparty_jurisdiction", "FR"),
    counterparty_rating: found("counterparty_rating", "AA"),
    liability_cap_exists: found("liability_cap_exists", true),
    termination_for_convenience: found("termination_for_convenience", true),
    contract_term_months: found("contract_term_months", 12),
    regulated_activity: found("regulated_activity", false),
    cross_border: found("cross_border", false),
    external_visibility: found("external_visibility", "none"),
    affected_parties_scope: found("affected_parties_scope", "single_team"),
  };
  for (const [id, f] of Object.entries(overrides)) {
    if (f === null) base[id] = notFound(id);
    else base[id] = f;
  }
  return { facts: Object.values(base) };
}

const run = (factSet: FactSet, subject: Subject = HUMAN) =>
  classify({ factSet, policy, subject, documents: DOCS });

describe("ACOS classification paths (starter-balanced)", () => {
  it("routine low-risk human action self-approves", () => {
    const r = run(facts());
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    expect(r.tier).toBe(0);
    expect(r.tierName).toBe("Self-approve");
    expect(r.derivation.composition?.triggers.every((t) => !t.fired)).toBe(true);
  });

  it("the same facts route an agent strictly higher (agent >= human, premium as data)", () => {
    const human = run(facts(), HUMAN);
    const agent = run(facts(), AGENT);
    expect(agent.status).toBe("ROUTED");
    if (agent.status !== "ROUTED" || human.status !== "ROUTED") return;
    expect(agent.tier).toBeGreaterThan(human.tier);
    const financial = agent.derivation.categoryEvaluations.find((e) => e.category === "financial");
    expect(financial?.appetiteRowApplied).toBe("agent_initiated");
  });

  it("a Severe exposure with unknown counterparty rating routes to Board with distance recorded", () => {
    const r = run(facts({ amount_base_total: found("amount_base_total", 4_200_000, "EUR"), counterparty_rating: null }));
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    expect(r.tierName).toBe("Board");
    const fin = r.derivation.categoryEvaluations.find((e) => e.category === "financial")!;
    expect(fin.impactBand).toBe("Severe");
    expect(fin.likelihoodBand).toBe("Possible"); // NOT_FOUND rating rule fired
    expect(fin.likelihoodRulesFired).toEqual(["counterparty_rating == NOT_FOUND"]);
    expect(r.derivation.composition?.baseTier.bindingCategory).toBe("financial");
  });

  it("needs_info category blocks routing with INCOMPLETE", () => {
    const r = run(facts({ regulated_activity: null }));
    expect(r.status).toBe("INCOMPLETE");
    if (r.status !== "INCOMPLETE") return;
    expect(r.missingFacts).toEqual([{ category: "regulatory", facts: ["regulated_activity"] }]);
    expect(r.derivation.explanation).toContain("No routing performed");
    // all other categories are still evaluated and recorded
    expect(r.derivation.categoryEvaluations).toHaveLength(6);
    expect(r.derivation.categoryEvaluations.filter((e) => e.handling === "scored")).toHaveLength(5);
  });

  it("escalate-on-missing scores the conservative band and never self-approves", () => {
    const r = run(facts({ termination_for_convenience: null, contract_term_months: null }));
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    const rev = r.derivation.categoryEvaluations.find((e) => e.category === "reversibility")!;
    expect(rev.handling).toBe("escalated_conservative");
    expect(rev.impactBand).toBe("Locked_in");
    expect(rev.missingFacts).toEqual(["termination_for_convenience", "contract_term_months"]);
    expect(r.tier).toBeGreaterThanOrEqual(1);
    expect(r.derivation.explanation).toContain("conservatively assessed");
  });

  it("sanctions trigger forces Board regardless of amounts", () => {
    const r = run(facts({ counterparty_jurisdiction: found("counterparty_jurisdiction", "IR") }));
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    expect(r.tierName).toBe("Board");
    const sanctions = r.derivation.composition!.triggers.find((t) => t.id === "sanctions_exposure")!;
    expect(sanctions.fired).toBe(true);
    expect(r.derivation.explanation).toContain("Zero appetite for sanctions exposure");
  });

  it("triggers are recorded even when NOT fired", () => {
    const r = run(facts());
    if (r.status !== "ROUTED") throw new Error("expected ROUTED");
    expect(r.derivation.composition!.triggers.map((t) => t.id)).toEqual([
      "sanctions_exposure",
      "uncapped_liability",
      "novel_precedent",
    ]);
  });

  it("accumulation counts categories at/above the rating and uplifts once", () => {
    const r = run(
      facts({
        amount_base_total: found("amount_base_total", 1_000_000, "EUR"),
        external_visibility: found("external_visibility", "international"),
        affected_parties_scope: found("affected_parties_scope", "ecosystem"),
        action_type: found("action_type", "standard_procurement"),
      })
    );
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    const acc = r.derivation.composition!.accumulation!;
    expect(acc.observedCount).toBeGreaterThanOrEqual(3);
    expect(acc.applied).toBe(true);
    expect(r.tier).toBe(4);
    expect(r.derivation.explanation).toContain("categories rated at or above");
  });

  it("money facts normalize through the fx snapshot (USD → EUR)", () => {
    // 30,000 USD × 0.92 = 27,600 EUR → Moderate, not Minor
    const r = run(facts({ amount_base_total: found("amount_base_total", 30_000, "USD") }));
    if (r.status !== "ROUTED") throw new Error("expected ROUTED");
    const fin = r.derivation.categoryEvaluations.find((e) => e.category === "financial")!;
    expect(fin.impactBand).toBe("Moderate");
  });

  it("unknown currency degrades to ⊥ and escalates, never crashes", () => {
    const r = run(facts({ amount_base_total: found("amount_base_total", 30_000, "XXX") }));
    if (r.status !== "ROUTED") throw new Error("expected ROUTED");
    const fin = r.derivation.categoryEvaluations.find((e) => e.category === "financial")!;
    expect(fin.handling).toBe("escalated_conservative"); // required fact unresolvable
  });

  it("agent without the attested counterparty_name is INCOMPLETE via agent_policy", () => {
    const r = run(facts({ counterparty_name: found("counterparty_name", "Acme GmbH") }), AGENT);
    expect(r.status).toBe("INCOMPLETE");
    if (r.status !== "INCOMPLETE") return;
    expect(r.missingFacts).toEqual([{ category: "agent_policy", facts: ["counterparty_name"] }]);
  });

  it("agent self-approve floor fires when appetite alone would allow tier 0", () => {
    const doc = parseYaml(yamlSource);
    doc.agent_policy.default_uplift = 0;
    for (const cat of doc.categories) delete cat.appetite_agent_initiated;
    const permissive = compileDocument(doc);
    const r = classify({ factSet: facts(), policy: permissive, subject: AGENT, documents: DOCS });
    expect(r.status).toBe("ROUTED");
    if (r.status !== "ROUTED") return;
    expect(r.tier).toBe(1);
    expect(r.derivation.composition!.agentUplift?.selfApproveFloorApplied).toBe(true);
    expect(r.derivation.explanation).toContain("may not self-approve");
  });

  it("the derivation pins policy hash and embeds the input fact set verbatim", () => {
    const input = facts();
    const r = run(input);
    if (r.status !== "ROUTED") throw new Error("expected ROUTED");
    expect(r.derivation.policy.contentHash).toBe(policy.contentHash);
    expect(r.derivation.factSet).toEqual(input);
    expect(r.derivation.engineVersion).toBe("2.0.0-alpha.0");
  });

  it("distance-from-boundary matches the canonical example shape", () => {
    // agent, High financial rating on row [1,2,4,4]: nearest tier change is 1 band below → above
    const r = run(
      facts({ amount_base_total: found("amount_base_total", 800_000, "EUR"), counterparty_rating: null }),
      AGENT
    );
    if (r.status !== "ROUTED") throw new Error("expected ROUTED");
    const fin = r.derivation.categoryEvaluations.find((e) => e.category === "financial")!;
    expect(fin.matrixRating).toBe("High");
    expect(fin.distanceFromNextBoundary).toEqual({ bands: 1, direction: "above" });
  });
});
