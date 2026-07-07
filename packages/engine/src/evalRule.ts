/**
 * Kleene 3-valued interpreter for compiled band rules.
 *
 * T / F / U where U propagates from ⊥ facts (Kleene strong: U and F = F,
 * U or T = T). The CALLER decides what U means — that context-dependence is
 * the unknown-dominance mechanism:
 *   impact band:     U = no-match (falls through toward `else`, i.e. severity)
 *   likelihood `if`: U = matched (min_band participates)
 *   trigger:         U = fired
 * The only node that observes absence directly (and never returns U) is
 * `fact == NOT_FOUND`.
 */
import type { CmpOp, RuleAst } from "@ddas/policy";
import type { Resolved } from "./resolve.js";

export type Tri = "T" | "F" | "U";

export interface EvalContext {
  resolved: Array<Resolved | undefined>;
  listSets: Array<Set<string>>;
}

const FLIP: Record<CmpOp, CmpOp> = { eq: "eq", ne: "ne", lt: "gt", le: "ge", gt: "lt", ge: "le" };

export function evalRule(ast: RuleAst, ctx: EvalContext): Tri {
  switch (ast.kind) {
    case "else":
      return "T";
    case "and": {
      let sawU = false;
      for (const c of ast.children) {
        const r = evalRule(c, ctx);
        if (r === "F") return "F";
        if (r === "U") sawU = true;
      }
      return sawU ? "U" : "T";
    }
    case "or": {
      let sawU = false;
      for (const c of ast.children) {
        const r = evalRule(c, ctx);
        if (r === "T") return "T";
        if (r === "U") sawU = true;
      }
      return sawU ? "U" : "F";
    }
    case "not": {
      const r = evalRule(ast.child, ctx);
      return r === "U" ? "U" : r === "T" ? "F" : "T";
    }
    case "not_found_check": {
      const absent = ctx.resolved[ast.factIdx] === undefined;
      return absent !== ast.negated ? "T" : "F";
    }
    case "cmp": {
      const r = ctx.resolved[ast.factIdx];
      if (r === undefined) return "U";
      const op = ast.flipped ? FLIP[ast.op] : ast.op; // normalize to fact-on-left
      switch (ast.lit.t) {
        case "num":
          return r.k === "num" ? bool(cmpOrd(r.v, ast.lit.v, op)) : "U";
        case "str":
          return r.k === "str" ? bool(cmpOrd(r.v, ast.lit.v, op)) : "U";
        case "bool":
          return r.k === "bool" ? bool(op === "eq" ? r.v === ast.lit.v : r.v !== ast.lit.v) : "U";
        case "enum":
          return r.k === "enum" ? bool(op === "eq" ? r.v === ast.lit.v : r.v !== ast.lit.v) : "U";
      }
      break;
    }
    case "in_list": {
      const r = ctx.resolved[ast.factIdx];
      if (r === undefined) return "U";
      const set = ctx.listSets[ast.listIdx]!;
      if (r.k === "str") return bool(set.has(r.v));
      if (r.k === "enum") return bool(set.has(r.s));
      return "U";
    }
    case "lit_in_fact": {
      const r = ctx.resolved[ast.factIdx];
      if (r === undefined) return "U";
      return r.k === "list" ? bool(r.v.includes(ast.lit)) : "U";
    }
  }
  return "U";
}

function bool(b: boolean): Tri {
  return b ? "T" : "F";
}

function cmpOrd<T extends number | string>(a: T, b: T, op: CmpOp): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "lt":
      return a < b;
    case "le":
      return a <= b;
    case "gt":
      return a > b;
    case "ge":
      return a >= b;
  }
}
