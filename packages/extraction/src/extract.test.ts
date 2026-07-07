import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePolicy } from "@ddas/policy";
import { describe, expect, it } from "vitest";
import { extractFacts, locateQuote, type LoadedDoc } from "./extract.js";
import type { ExtractionProvider } from "./provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const policy = compilePolicy(readFileSync(join(here, "../../policy/templates/starter-balanced.yaml"), "utf8"));

const DOC: LoadedDoc = {
  name: "msa.md",
  text: "MASTER SERVICES AGREEMENT\n\nThe aggregate fees shall be EUR 4,200,000 over the Term.\nEither party may terminate   for convenience\nwith 30 days notice.\nGoverning law: France.",
  sha256: "d".repeat(64),
};

/** Stub provider replaying a queue of canned responses; records the prompts it saw. */
function stub(responses: string[]): ExtractionProvider & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    id: "stub",
    model: "stub-1",
    calls,
    async complete(req) {
      calls.push({ system: req.system, user: req.user });
      const next = responses.shift();
      if (next === undefined) throw new Error("stub exhausted");
      return next;
    },
  };
}

const entry = (id: string, quote: string, value: unknown, unit?: string) =>
  ({ id, status: "FOUND", value, ...(unit ? { unit } : {}), confidence: 0.95, citation: { doc_index: 0, quote } });

const notFoundEntries = (ids: string[]) => ids.map((id) => ({ id, status: "NOT_FOUND" }));

const REST = [
  "action_type",
  "counterparty_name",
  "counterparty_jurisdiction",
  "counterparty_rating",
  "liability_cap_exists",
  "regulated_activity",
  "cross_border",
  "external_visibility",
  "affected_parties_scope",
];

describe("locateQuote", () => {
  it("finds exact substrings", () => {
    expect(locateQuote(DOC.text, "EUR 4,200,000")).toEqual({
      span: [DOC.text.indexOf("EUR 4,200,000"), DOC.text.indexOf("EUR 4,200,000") + "EUR 4,200,000".length],
      text: "EUR 4,200,000",
    });
  });

  it("snaps whitespace-normalized matches back to the raw slice", () => {
    const located = locateQuote(DOC.text, "may terminate for convenience with 30 days notice");
    expect(located).not.toBeNull();
    // the stored text must be literally present in the document
    expect(DOC.text.slice(located!.span[0], located!.span[1])).toBe(located!.text);
    expect(located!.text).toContain("terminate   for convenience");
  });

  it("returns null for fabricated quotes", () => {
    expect(locateQuote(DOC.text, "liability is capped at EUR 1")).toBeNull();
  });
});

describe("extractFacts", () => {
  it("grounds cited facts and fills omitted ones as NOT_FOUND", async () => {
    const provider = stub([
      JSON.stringify({
        facts: [
          entry("amount_base_total", "EUR 4,200,000 over the Term", 4200000, "EUR"),
          entry("termination_for_convenience", "may terminate   for convenience", true),
          ...notFoundEntries(REST),
          // contract_term_months omitted entirely
        ],
      }),
    ]);
    const { factSet, report } = await extractFacts([DOC], policy, provider);
    const amount = factSet.facts.find((f) => f.id === "amount_base_total")!;
    expect(amount.status).toBe("FOUND");
    expect(amount.value).toBe(4200000);
    expect(amount.citation!.text).toBe("EUR 4,200,000 over the Term");
    expect(DOC.text.slice(amount.citation!.span[0], amount.citation!.span[1])).toBe(amount.citation!.text);
    expect(report.found).toBe(2);
    expect(report.missingEntriesFilledNotFound).toEqual(["contract_term_months"]);
    expect(factSet.facts.find((f) => f.id === "contract_term_months")!.status).toBe("NOT_FOUND");
    expect(factSet.extraction).toEqual({ model: "stub-1", promptHash: report.promptHash });
  });

  it("re-asks once for ungroundable citations, then accepts the corrected quote", async () => {
    const provider = stub([
      JSON.stringify({
        facts: [
          entry("amount_base_total", "fees of about four million", 4200000, "EUR"),
          ...notFoundEntries([...REST, "termination_for_convenience", "contract_term_months"]),
        ],
      }),
      JSON.stringify({ facts: [entry("amount_base_total", "EUR 4,200,000", 4200000, "EUR")] }),
    ]);
    const { factSet, report } = await extractFacts([DOC], policy, provider);
    expect(report.citationsRetried).toEqual(["amount_base_total"]);
    expect(report.citationsDowngraded).toEqual([]);
    expect(factSet.facts.find((f) => f.id === "amount_base_total")!.status).toBe("FOUND");
    expect(provider.calls[1]!.user).toContain("not a verbatim substring");
  });

  it("downgrades to NOT_FOUND when the retry still cannot ground (fail-closed)", async () => {
    const provider = stub([
      JSON.stringify({
        facts: [
          entry("liability_cap_exists", "liability is capped at EUR 1", true),
          ...notFoundEntries([...REST.filter((r) => r !== "liability_cap_exists"), "amount_base_total", "termination_for_convenience", "contract_term_months"]),
        ],
      }),
      JSON.stringify({ facts: [entry("liability_cap_exists", "still a fabricated quote", true)] }),
    ]);
    const { factSet, report } = await extractFacts([DOC], policy, provider);
    expect(report.citationsDowngraded).toEqual(["liability_cap_exists"]);
    const fact = factSet.facts.find((f) => f.id === "liability_cap_exists")!;
    expect(fact.status).toBe("NOT_FOUND");
    expect(fact.value).toBeUndefined();
  });

  it("drops undeclared fact ids", async () => {
    const provider = stub([
      JSON.stringify({
        facts: [
          { id: "made_up_fact", status: "FOUND", value: 1, citation: { doc_index: 0, quote: "MASTER" } },
          ...notFoundEntries([...REST, "amount_base_total", "termination_for_convenience", "contract_term_months"]),
        ],
      }),
    ]);
    const { factSet, report } = await extractFacts([DOC], policy, provider);
    expect(report.undeclaredIdsDropped).toEqual(["made_up_fact"]);
    expect(factSet.facts.some((f) => f.id === "made_up_fact")).toBe(false);
  });

  it("retries once on unparseable output, then fails loudly", async () => {
    const good = JSON.stringify({ facts: notFoundEntries([...REST, "amount_base_total", "termination_for_convenience", "contract_term_months"]) });
    const okProvider = stub(["this is not json", "```json\n" + good + "\n```"]);
    const { report } = await extractFacts([DOC], policy, okProvider);
    expect(report.notFound).toBe(12);

    const badProvider = stub(["nope", "still nope"]);
    await expect(extractFacts([DOC], policy, badProvider)).rejects.toThrow();
  });

  it("embeds the policy fact schema in the system prompt", async () => {
    const provider = stub([
      JSON.stringify({ facts: notFoundEntries([...REST, "amount_base_total", "termination_for_convenience", "contract_term_months"]) }),
    ]);
    await extractFacts([DOC], policy, provider);
    expect(provider.calls[0]!.system).toContain("amount_base_total");
    expect(provider.calls[0]!.system).toContain("NEVER infer");
  });
});
