/**
 * Pinned derivation fixtures: starter-balanced + 6 hand-written fact sets →
 * byte-exact derivations committed as JSON files. These files double as
 * documentation and as Phase 2 regression seeds. Regenerate deliberately with
 *   DDAS_UPDATE_FIXTURES=1 pnpm --filter @ddas/engine test
 * and review the diff like any code change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, compilePolicy } from "@ddas/policy";
import { describe, expect, it } from "vitest";
import { classify } from "./classify.js";
import type { Fact, FactSet, Subject } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures");
const UPDATE = process.env["DDAS_UPDATE_FIXTURES"] === "1";

const policy = compilePolicy(
  readFileSync(join(here, "../../policy/templates/starter-balanced.yaml"), "utf8")
);

const HUMAN: Subject = { initiatorKind: "human", initiator: "user:j.doe", actionType: "vendor_contract_renewal" };
const AGENT: Subject = { initiatorKind: "agent", initiator: "agent:procure-bot-3", onBehalfOf: "user:j.doe", actionType: "vendor_contract_renewal" };
const DOCS = [{ name: "msa.md", sha256: "0".repeat(64) }];

const found = (id: string, value: Fact["value"], unit?: string): Fact =>
  ({ id, status: "FOUND", value, ...(unit ? { unit } : {}), citation: { docIndex: 0, span: [0, 10], text: "cited span" } }) as Fact;
const notFound = (id: string): Fact => ({ id, status: "NOT_FOUND" }) as Fact;
const manual = (id: string, value: Fact["value"]): Fact => ({ id, status: "MANUAL", value, attestedBy: "user:j.doe" }) as Fact;

function baseFacts(overrides: Record<string, Fact> = {}): FactSet {
  const base: Record<string, Fact> = {
    amount_base_total: found("amount_base_total", 5000, "EUR"),
    action_type: found("action_type", "vendor_contract_renewal"),
    counterparty_name: manual("counterparty_name", "Acme GmbH"),
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
  return { facts: Object.values({ ...base, ...overrides }) };
}

const CASES: Array<{ name: string; factSet: FactSet; subject: Subject }> = [
  { name: "01-routine-human-low", factSet: baseFacts(), subject: HUMAN },
  { name: "02-agent-same-facts", factSet: baseFacts(), subject: AGENT },
  {
    name: "03-severe-usd-fx",
    factSet: baseFacts({ amount_base_total: found("amount_base_total", 5_000_000, "USD"), counterparty_rating: notFound("counterparty_rating") }),
    subject: HUMAN,
  },
  {
    name: "04-sanctions-trigger",
    factSet: baseFacts({ counterparty_jurisdiction: found("counterparty_jurisdiction", "IR") }),
    subject: HUMAN,
  },
  {
    name: "05-accumulation",
    factSet: baseFacts({
      amount_base_total: found("amount_base_total", 1_000_000, "EUR"),
      external_visibility: found("external_visibility", "international"),
      affected_parties_scope: found("affected_parties_scope", "ecosystem"),
      action_type: found("action_type", "standard_procurement"),
    }),
    subject: HUMAN,
  },
  {
    name: "06-missing-escalate",
    factSet: baseFacts({
      termination_for_convenience: notFound("termination_for_convenience"),
      contract_term_months: notFound("contract_term_months"),
    }),
    subject: HUMAN,
  },
];

describe("pinned derivation fixtures (starter-balanced)", () => {
  it("policy content hash is pinned", () => {
    const path = join(fixturesDir, "starter-balanced.hash.json");
    if (UPDATE || !existsSync(path)) {
      mkdirSync(fixturesDir, { recursive: true });
      writeFileSync(path, JSON.stringify({ contentHash: policy.contentHash }, null, 2) + "\n");
    }
    const pinned = JSON.parse(readFileSync(path, "utf8"));
    expect(policy.contentHash).toBe(pinned.contentHash);
  });

  it.each(CASES)("$name reproduces its pinned derivation byte-for-byte", ({ name, factSet, subject }) => {
    const result = classify({ factSet, policy, subject, documents: DOCS });
    const canonical = canonicalize(result as never);
    const path = join(fixturesDir, `${name}.json`);
    if (UPDATE || !existsSync(path)) {
      mkdirSync(fixturesDir, { recursive: true });
      writeFileSync(path, JSON.stringify(JSON.parse(canonical), null, 2) + "\n");
    }
    const pinned = canonicalize(JSON.parse(readFileSync(path, "utf8")));
    expect(canonical).toBe(pinned);
  });
});
