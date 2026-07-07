/**
 * Binder: surface AST → compiled AST.
 *
 * Resolves identifiers against the policy's declared facts and reference
 * lists, assigns integer indices, and type-checks every predicate. All DSL
 * type errors happen HERE, at policy compile time — the engine can only ever
 * see well-typed ASTs (its single runtime "error" is the unknown value ⊥).
 */
import { RuleError, type CmpOp, type Lit, type RuleAst, type SExpr, type SOperand } from "./ast.js";

export type FactType =
  | "money"
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "duration"
  | "enum"
  | "list";

export interface BindContext {
  facts: Map<string, { idx: number; type: FactType; enumValues?: string[] }>;
  lists: Map<string, number>;
}

const ORDINAL_TYPES: ReadonlySet<FactType> = new Set(["money", "number", "duration", "date"]);

export function bindRule(expr: SExpr, ctx: BindContext, opts: { allowElse: boolean }): RuleAst {
  switch (expr.kind) {
    case "else":
      if (!opts.allowElse)
        throw new RuleError("else_not_allowed", "'else' is only legal as the last impact band rule");
      return { kind: "else" };
    case "and":
    case "or":
      return { kind: expr.kind, children: expr.children.map((c) => bindRule(c, ctx, { allowElse: false })) };
    case "not":
      return { kind: "not", child: bindRule(expr.child, ctx, { allowElse: false }) };
    case "cmp":
      return bindCmp(expr.left, expr.op, expr.right, ctx);
    case "in":
      return bindIn(expr.left, expr.listName, ctx);
  }
}

function isFactRef(op: SOperand, ctx: BindContext): boolean {
  return op.t === "ident" && ctx.facts.has(op.name);
}

function bindCmp(left: SOperand, op: CmpOp, right: SOperand, ctx: BindContext): RuleAst {
  const leftIsFact = isFactRef(left, ctx);
  const rightIsFact = isFactRef(right, ctx);
  if (leftIsFact && rightIsFact)
    throw new RuleError("two_fact_sides", "a comparison must have exactly one fact side (fact-to-fact comparison is not supported)");
  if (!leftIsFact && !rightIsFact) {
    const unknownIdent = [left, right].find((o) => o.t === "ident");
    if (unknownIdent && unknownIdent.t === "ident" && looksLikeFactId(unknownIdent.name))
      throw new RuleError("no_fact_side", `a comparison must reference a declared fact ('${unknownIdent.name}' is not declared)`);
    throw new RuleError("no_fact_side", "a comparison must have exactly one fact side");
  }
  const factOp = (leftIsFact ? left : right) as { t: "ident"; name: string };
  const litOp = leftIsFact ? right : left;
  const flipped = rightIsFact;
  const fact = ctx.facts.get(factOp.name)!;
  const factIdx = fact.idx;

  // NOT_FOUND — the only absence-observing predicate.
  if (litOp.t === "not_found") {
    if (op !== "eq" && op !== "ne")
      throw new RuleError("not_found_bad_op", "NOT_FOUND may only be compared with == or !=");
    return { kind: "not_found_check", factIdx, negated: op === "ne" };
  }

  if (fact.type === "list")
    throw new RuleError("type_mismatch", `list-typed fact '${factOp.name}' can only be used with 'in'`);

  const lit = coerceLit(litOp, fact, factOp.name);
  const ordinal = op === "lt" || op === "le" || op === "gt" || op === "ge";
  if (ordinal && !ORDINAL_TYPES.has(fact.type))
    throw new RuleError("type_mismatch", `ordinal comparison on non-ordinal fact '${factOp.name}' (${fact.type})`);
  return { kind: "cmp", factIdx, op, lit, flipped };
}

function coerceLit(
  litOp: SOperand,
  fact: { type: FactType; enumValues?: string[] },
  factName: string
): Lit {
  switch (fact.type) {
    case "money":
    case "number":
    case "duration":
      if (litOp.t !== "num")
        throw new RuleError("type_mismatch", `fact '${factName}' (${fact.type}) requires a numeric literal`);
      return { t: "num", v: litOp.v };
    case "date": {
      if (litOp.t !== "str")
        throw new RuleError("type_mismatch", `fact '${factName}' (date) requires a quoted ISO date literal`);
      return { t: "str", v: litOp.v };
    }
    case "boolean":
      if (litOp.t !== "bool")
        throw new RuleError("type_mismatch", `fact '${factName}' (boolean) requires true or false`);
      return { t: "bool", v: litOp.v };
    case "enum": {
      const raw = litOp.t === "str" ? litOp.v : litOp.t === "ident" ? litOp.name : null;
      if (raw === null)
        throw new RuleError("type_mismatch", `fact '${factName}' (enum) requires a value literal`);
      const idx = (fact.enumValues ?? []).indexOf(raw);
      if (idx === -1)
        throw new RuleError("enum_value_unknown", `'${raw}' is not a declared value of enum fact '${factName}'`);
      return { t: "enum", v: idx };
    }
    case "string": {
      const raw = litOp.t === "str" ? litOp.v : litOp.t === "ident" ? litOp.name : null;
      if (raw === null)
        throw new RuleError("type_mismatch", `fact '${factName}' (string) requires a string literal`);
      return { t: "str", v: raw };
    }
    case "list":
      throw new RuleError("type_mismatch", `list-typed fact '${factName}' can only be used with 'in'`);
  }
}

function bindIn(left: SOperand, listName: string, ctx: BindContext): RuleAst {
  if (left.t === "ident" && ctx.facts.has(left.name)) {
    const fact = ctx.facts.get(left.name)!;
    if (fact.type !== "string" && fact.type !== "enum")
      throw new RuleError("type_mismatch", `'in' membership needs a string/enum fact on the left ('${left.name}' is ${fact.type})`);
    const listIdx = ctx.lists.get(listName);
    if (listIdx === undefined) {
      if (ctx.facts.has(listName))
        throw new RuleError("in_shape", `'${left.name} in ${listName}': the right side must be a reference list, not a fact`);
      throw new RuleError("unknown_list", `unknown reference list '${listName}'`);
    }
    return { kind: "in_list", factIdx: fact.idx, listIdx };
  }
  // literal in list-typed fact
  const litRaw = left.t === "str" ? left.v : left.t === "ident" ? left.name : null;
  if (litRaw === null)
    throw new RuleError("type_mismatch", "'in' with a literal left side requires a string literal");
  const fact = ctx.facts.get(listName);
  if (!fact) {
    if (ctx.lists.has(listName))
      throw new RuleError("in_shape", `'${litRaw} in ${listName}' is constant — the left side must be a fact, or the right side a list-typed fact`);
    throw new RuleError("unknown_fact", `unknown fact '${listName}'`);
  }
  if (fact.type !== "list")
    throw new RuleError("type_mismatch", `'${litRaw} in ${listName}' requires '${listName}' to be a list-typed fact (it is ${fact.type})`);
  return { kind: "lit_in_fact", lit: litRaw, factIdx: fact.idx };
}

/** Heuristic only used to sharpen an error message. */
function looksLikeFactId(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name) && name.includes("_");
}

/** Every fact index a compiled rule reads (for lint bookkeeping / required-facts hints). */
export function factIndicesOf(ast: RuleAst): number[] {
  const out = new Set<number>();
  const walk = (n: RuleAst): void => {
    switch (n.kind) {
      case "and":
      case "or":
        n.children.forEach(walk);
        break;
      case "not":
        walk(n.child);
        break;
      case "cmp":
      case "not_found_check":
      case "in_list":
      case "lit_in_fact":
        out.add(n.factIdx);
        break;
      case "else":
        break;
    }
  };
  walk(ast);
  return [...out].sort((a, b) => a - b);
}
