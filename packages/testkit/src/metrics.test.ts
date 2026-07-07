import { describe, expect, it } from "vitest";
import type { Fact } from "@ddas/engine";
import { buildScoreboard, scoreCase, type LabeledFact } from "./metrics.js";

const DOC = "The fee is EUR 100,000 for the term. No liability cap applies. Payment net 30.";

const labels: LabeledFact[] = [
  { id: "amount", status: "FOUND", value: 100000, unit: "EUR", value_tolerance: 0.01, citation: { doc_index: 0, text: "EUR 100,000" } },
  { id: "liability_cap_exists", status: "FOUND", value: false, citation: { doc_index: 0, text: "No liability cap applies" } },
  { id: "termination", status: "NOT_FOUND" },
  { id: "rating", status: "NOT_FOUND" },
];

const fact = (id: string, value: unknown, quoteStart: number, quote: string): Fact =>
  ({
    id,
    status: "FOUND",
    value,
    ...(id === "amount" ? { unit: "EUR" } : {}),
    citation: { docIndex: 0, span: [quoteStart, quoteStart + quote.length], text: quote },
  }) as Fact;

describe("extraction metrics", () => {
  it("scores a perfect extraction as all-true", () => {
    const extracted: Fact[] = [
      fact("amount", 100000, DOC.indexOf("EUR 100,000"), "EUR 100,000"),
      fact("liability_cap_exists", false, DOC.indexOf("No liability cap"), "No liability cap applies"),
      { id: "termination", status: "NOT_FOUND" } as Fact,
      { id: "rating", status: "NOT_FOUND" } as Fact,
    ];
    const board = buildScoreboard([scoreCase(labels, extracted, [DOC])], {
      amount: "money",
      liability_cap_exists: "boolean",
      termination: "boolean",
      rating: "string",
    });
    expect(board.aggregate.precision).toBe(1);
    expect(board.aggregate.recall).toBe(1);
    expect(board.aggregate.valueAccuracy).toBe(1);
    expect(board.aggregate.citationFidelity).toBe(1);
    expect(board.headline.falseFactRate).toBe(0);
  });

  it("counts a hallucinated fact as the headline false-fact", () => {
    const extracted: Fact[] = [
      fact("amount", 100000, DOC.indexOf("EUR 100,000"), "EUR 100,000"),
      fact("liability_cap_exists", false, DOC.indexOf("No liability cap"), "No liability cap applies"),
      fact("termination", true, 0, "The fee"), // hallucinated: labeled NOT_FOUND
      { id: "rating", status: "NOT_FOUND" } as Fact,
    ];
    const board = buildScoreboard([scoreCase(labels, extracted, [DOC])], {});
    expect(board.headline.falseFactRate).toBe(0.5); // 1 of 2 labeled-NOT_FOUND
    expect(board.aggregate.notFoundRecall).toBe(0.5);
  });

  it("value accuracy respects tolerance and unit; citation fidelity requires overlap", () => {
    const extracted: Fact[] = [
      // value within 1% tolerance but cited from the WRONG place
      fact("amount", 100500, 0, "The fee"),
      fact("liability_cap_exists", true, DOC.indexOf("No liability cap"), "No liability cap applies"), // wrong value
      { id: "termination", status: "NOT_FOUND" } as Fact,
      { id: "rating", status: "NOT_FOUND" } as Fact,
    ];
    const board = buildScoreboard([scoreCase(labels, extracted, [DOC])], {});
    expect(board.perFactId["amount"]!.valueAccurate).toBe(1); // within tolerance
    expect(board.perFactId["amount"]!.citationValid).toBe(0); // no overlap with label span
    expect(board.perFactId["liability_cap_exists"]!.valueAccurate).toBe(0);
    expect(board.perFactId["liability_cap_exists"]!.citationValid).toBe(1);
  });

  it("missed facts count as false negatives", () => {
    const extracted: Fact[] = [{ id: "amount", status: "NOT_FOUND" } as Fact];
    const board = buildScoreboard([scoreCase(labels, extracted, [DOC])], {});
    expect(board.aggregate.fn).toBe(2); // amount + liability_cap_exists
    expect(board.aggregate.recall).toBe(0);
  });
});
