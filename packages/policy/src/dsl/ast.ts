/**
 * Band-rule DSL — AST types.
 *
 * Two layers:
 *  - Surface AST (SExpr): what the parser produces from source text; still
 *    carries identifier names.
 *  - Compiled AST (RuleAst): identifiers resolved to integer fact/list indices
 *    and every comparison type-checked. The engine only ever sees RuleAst —
 *    plain JSON-serializable data, no string lookups, no runtime type errors.
 *
 * The DSL is deliberately not Turing-complete: comparisons, list membership,
 * boolean combinations, and the `else` catch-all. Nothing else, ever
 * (see docs/adr/0004 and CONTRIBUTING.md).
 */

export type CmpOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

// ---------- Surface (parser output) ----------

export type SOperand =
  | { t: "ident"; name: string }
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "not_found" };

export type SExpr =
  | { kind: "else" }
  | { kind: "and" | "or"; children: SExpr[] }
  | { kind: "not"; child: SExpr }
  | { kind: "cmp"; left: SOperand; op: CmpOp; right: SOperand }
  | { kind: "in"; left: SOperand; listName: string };

// ---------- Compiled (binder output; what the engine evaluates) ----------

export type Lit =
  | { t: "num"; v: number } // money literals are base-currency by construction
  | { t: "str"; v: string } // also ISO dates (lexicographic comparison is valid for ISO-8601)
  | { t: "bool"; v: boolean }
  | { t: "enum"; v: number }; // pre-resolved to the fact's value index

export type RuleAst =
  | { kind: "else" }
  | { kind: "and" | "or"; children: RuleAst[] }
  | { kind: "not"; child: RuleAst }
  | { kind: "cmp"; factIdx: number; op: CmpOp; lit: Lit; flipped: boolean }
  | { kind: "not_found_check"; factIdx: number; negated: boolean }
  | { kind: "in_list"; factIdx: number; listIdx: number }
  | { kind: "lit_in_fact"; lit: string; factIdx: number };

// ---------- Errors ----------

export class RuleError extends Error {
  constructor(
    public readonly code:
      | "parse_error"
      | "unknown_fact"
      | "unknown_list"
      | "type_mismatch"
      | "not_found_bad_op"
      | "no_fact_side"
      | "two_fact_sides"
      | "else_not_allowed"
      | "enum_value_unknown"
      | "in_shape",
    message: string,
    public readonly pos?: number
  ) {
    super(message);
    this.name = "RuleError";
  }
}
