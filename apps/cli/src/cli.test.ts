/**
 * Full CLI flow against a temp store: register → activate → submit → classify
 * → simulate a draft. Exercises the command functions directly (no spawning).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cmdClassify,
  cmdPolicyActivate,
  cmdPolicyLint,
  cmdPolicyList,
  cmdPolicyRegister,
  cmdSimulate,
  cmdSubmit,
  type Output,
} from "./commands.js";
import { Store } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, "../../../packages/policy/templates/starter-balanced.yaml");

function capture(): Output & { lines: string[] } {
  const lines: string[] = [];
  return { lines, log: (l) => lines.push(l), error: (l) => lines.push(`ERR ${l}`) };
}

const FACTS = {
  facts: [
    { id: "amount_base_total", status: "FOUND", value: 4200000, unit: "EUR", citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "action_type", status: "FOUND", value: "vendor_contract_renewal", citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "counterparty_name", status: "MANUAL", value: "Acme GmbH", attestedBy: "user:j.doe" },
    { id: "counterparty_jurisdiction", status: "FOUND", value: "FR", citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "counterparty_rating", status: "NOT_FOUND" },
    { id: "liability_cap_exists", status: "FOUND", value: false, citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "termination_for_convenience", status: "FOUND", value: false, citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "contract_term_months", status: "FOUND", value: 48, citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "regulated_activity", status: "FOUND", value: false, citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "cross_border", status: "FOUND", value: true, citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "external_visibility", status: "FOUND", value: "industry", citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
    { id: "affected_parties_scope", status: "FOUND", value: "external_parties", citation: { docIndex: 0, span: [0, 5], text: "MSA d" } },
  ],
};

describe("ddas CLI flow", () => {
  const dir = mkdtempSync(join(tmpdir(), "ddas-cli-"));
  const store = new Store(join(dir, ".ddas"));
  const docPath = join(dir, "msa.md");
  const factsPath = join(dir, "facts.json");
  writeFileSync(docPath, "MSA draft v4 — aggregate fees EUR 4,200,000 over the Term.\n");
  writeFileSync(factsPath, JSON.stringify(FACTS, null, 2));

  it("lints the starter template clean", () => {
    const out = capture();
    expect(cmdPolicyLint(templatePath, out)).toBe(0);
    expect(out.lines.at(-1)).toMatch(/^OK starter-balanced@1 sha256:/);
  });

  it("registers, activates, and lists", () => {
    const out = capture();
    expect(cmdPolicyRegister(templatePath, store, out)).toBe(0);
    expect(cmdPolicyActivate("starter-balanced@1", store, out)).toBe(0);
    expect(out.lines.some((l) => l.includes("WARNING: no simulation report"))).toBe(true);
    const list = capture();
    cmdPolicyList(store, list);
    expect(list.lines[0]).toMatch(/^\* starter-balanced@1 sha256:/);
  });

  it("rejects re-registering a changed document under the same version", () => {
    const yaml = readFileSync(templatePath, "utf8").replace("Starter policy (Balanced)", "Tampered");
    const tampered = join(dir, "tampered.yaml");
    writeFileSync(tampered, yaml);
    const out = capture();
    expect(() => cmdPolicyRegister(tampered, store, out)).toThrow(/immutable/);
  });

  it("submits with a fact file and classifies to Board", async () => {
    const out = capture();
    expect(
      await cmdSubmit([docPath], { facts: factsPath, initiator: "user:j.doe", actionType: "vendor_contract_renewal" }, store, out)
    ).toBe(0);
    expect(out.lines[0]).toContain("sub-0001");

    const cls = capture();
    expect(cmdClassify("sub-0001", undefined, store, cls)).toBe(0);
    expect(cls.lines[0]).toBe("ROUTED → tier 4 (Board)");
    expect(cls.lines.some((l) => l.includes("derivation:"))).toBe(true);
  });

  it("agent submissions require an accountable owner", async () => {
    const out = capture();
    expect(await cmdSubmit([docPath], { facts: factsPath, initiator: "agent:bot" }, store, out)).toBe(1);
    expect(out.lines[0]).toContain("--on-behalf-of");
  });

  it("simulates a draft against the active policy and reports the shift", () => {
    // draft v2: raise the Minor band so the Severe deal is unchanged, but also
    // drop Board appetite for financial Critical → tier changes are visible
    const yaml = readFileSync(templatePath, "utf8")
      .replace("\nversion: 1", "\nversion: 2")
      .replace("appetite: { Low: 0, Moderate: 1, High: 3, Critical: 4 }", "appetite: { Low: 1, Moderate: 2, High: 3, Critical: 4 }");
    const draftPath = join(dir, "draft-v2.yaml");
    writeFileSync(draftPath, yaml);

    const out = capture();
    expect(cmdSimulate(draftPath, undefined, store, out)).toBe(0);
    expect(out.lines.some((l) => /sub-0001\s+T4 → T4/.test(l))).toBe(true);
    expect(out.lines.some((l) => l.includes("submissions change under starter-balanced@2"))).toBe(true);
    expect(out.lines.some((l) => l.startsWith("report: "))).toBe(true);
  });
});
