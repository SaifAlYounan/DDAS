import { describe, expect, it } from "vitest";
import { RuleError } from "./ast.js";
import { bindRule, factIndicesOf, type BindContext } from "./bind.js";
import { parseRule } from "./parser.js";

const ctx: BindContext = {
  facts: new Map([
    ["amount_base_total", { idx: 0, type: "money" }],
    ["counterparty_rating", { idx: 1, type: "string" }],
    ["counterparty_jurisdiction", { idx: 2, type: "string" }],
    ["liability_cap_exists", { idx: 3, type: "boolean" }],
    ["contract_term_months", { idx: 4, type: "number" }],
    ["external_visibility", { idx: 5, type: "enum", enumValues: ["none", "industry", "national", "international"] }],
    ["action_type", { idx: 6, type: "string" }],
    ["signing_date", { idx: 7, type: "date" }],
    ["obligations", { idx: 8, type: "list" }],
  ]),
  lists: new Map([
    ["sanctions_list", 0],
    ["approved_precedents", 1],
  ]),
};

const bind = (src: string, allowElse = false) => bindRule(parseRule(src), ctx, { allowElse });

describe("parser", () => {
  it("parses precedence: or < and < not", () => {
    const ast = parseRule("not liability_cap_exists == true and contract_term_months < 12 or amount_base_total < 5");
    expect(ast.kind).toBe("or");
  });

  it("parses parentheses", () => {
    const ast = parseRule("not (action_type in approved_precedents)");
    expect(ast).toEqual({ kind: "not", child: { kind: "in", left: { t: "ident", name: "action_type" }, listName: "approved_precedents" } });
  });

  it("parses else as a whole rule only", () => {
    expect(parseRule("else")).toEqual({ kind: "else" });
    expect(() => parseRule("else and true == true")).toThrow(RuleError);
  });

  it("rejects trailing garbage and bad tokens", () => {
    expect(() => parseRule("amount_base_total < 5 extra")).toThrow(RuleError);
    expect(() => parseRule("amount_base_total <> 5")).toThrow(RuleError);
    expect(() => parseRule("== 5")).toThrow(RuleError);
    expect(() => parseRule("amount_base_total < 'unterminated")).toThrow(RuleError);
  });

  it("parses quoted strings with escapes", () => {
    expect(parseRule("counterparty_rating == 'A\\'A'")).toEqual({
      kind: "cmp",
      left: { t: "ident", name: "counterparty_rating" },
      op: "eq",
      right: { t: "str", v: "A'A" },
    });
  });
});

describe("binder", () => {
  it("binds fact-on-left comparisons", () => {
    expect(bind("amount_base_total < 25000")).toEqual({
      kind: "cmp",
      factIdx: 0,
      op: "lt",
      lit: { t: "num", v: 25000 },
      flipped: false,
    });
  });

  it("binds fact-on-right (flipped)", () => {
    expect(bind("25000 > amount_base_total")).toMatchObject({ kind: "cmp", factIdx: 0, op: "gt", flipped: true });
  });

  it("binds NOT_FOUND checks and rejects ordinal NOT_FOUND", () => {
    expect(bind("counterparty_rating == NOT_FOUND")).toEqual({ kind: "not_found_check", factIdx: 1, negated: false });
    expect(bind("counterparty_rating != NOT_FOUND")).toEqual({ kind: "not_found_check", factIdx: 1, negated: true });
    expect(() => bind("amount_base_total < NOT_FOUND")).toThrow(/NOT_FOUND/);
  });

  it("resolves barewords contextually: enum member vs string literal", () => {
    expect(bind("external_visibility == none")).toEqual({
      kind: "cmp",
      factIdx: 5,
      op: "eq",
      lit: { t: "enum", v: 0 },
      flipped: false,
    });
    expect(bind("action_type == vendor_contract")).toMatchObject({ lit: { t: "str", v: "vendor_contract" } });
    expect(() => bind("external_visibility == galactic")).toThrow(/not a declared value/);
  });

  it("binds list membership both ways", () => {
    expect(bind("counterparty_jurisdiction in sanctions_list")).toEqual({ kind: "in_list", factIdx: 2, listIdx: 0 });
    expect(bind("'deliver_specs' in obligations")).toEqual({ kind: "lit_in_fact", lit: "deliver_specs", factIdx: 8 });
  });

  it("rejects malformed 'in' shapes", () => {
    expect(() => bind("obligations in sanctions_list")).toThrow(/string\/enum fact/);
    expect(() => bind("'x' in sanctions_list")).toThrow(/constant/);
    expect(() => bind("counterparty_jurisdiction in obligations")).toThrow(/reference list, not a fact/);
    expect(() => bind("counterparty_jurisdiction in nonexistent")).toThrow(/unknown reference list/);
  });

  it("type-checks operators per fact type", () => {
    expect(() => bind("liability_cap_exists < true")).toThrow(/ordinal|boolean/);
    expect(() => bind("counterparty_rating < 'AAA'")).toThrow(/ordinal/);
    expect(() => bind("liability_cap_exists == 'yes'")).toThrow(/requires true or false/);
    expect(() => bind("amount_base_total == 'big'")).toThrow(/numeric/);
    expect(bind("signing_date >= '2026-01-01'")).toMatchObject({ kind: "cmp", factIdx: 7, op: "ge", lit: { t: "str", v: "2026-01-01" } });
  });

  it("rejects fact-to-fact and no-fact comparisons", () => {
    expect(() => bind("amount_base_total == contract_term_months")).toThrow(/exactly one fact side/);
    expect(() => bind("5 == 6")).toThrow(/fact side/);
    expect(() => bind("unknown_fact_here == 5")).toThrow(/not declared/);
  });

  it("gates 'else' on allowElse", () => {
    expect(bind("else", true)).toEqual({ kind: "else" });
    expect(() => bind("else", false)).toThrow(/last impact band/);
  });

  it("reports the fact indices a rule reads", () => {
    const ast = bind("amount_base_total < 5 and (counterparty_jurisdiction in sanctions_list or liability_cap_exists == false)");
    expect(factIndicesOf(ast)).toEqual([0, 2, 3]);
  });
});
