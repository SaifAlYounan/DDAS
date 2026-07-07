/**
 * Fact resolution: FactSet → typed value vector indexed by the compiled
 * policy's factIdx. Runs once per classify call.
 *
 * ⊥ (undefined) marks the unknown value: NOT_FOUND, absent from the fact set,
 * or unresolvable (wrong runtime type, unknown currency, undeclared enum
 * value). Extraction noise never crashes the engine — it degrades to ⊥, which
 * the evaluator treats in the risk-raising direction.
 */
import type { CompiledIndices } from "@ddas/policy";
import type { FactSet } from "./types.js";

export type Resolved =
  | { k: "num"; v: number } // money (normalized to base currency), number, duration
  | { k: "str"; v: string } // string, date (ISO — lexicographic comparison is valid)
  | { k: "bool"; v: boolean }
  | { k: "enum"; v: number; s: string }
  | { k: "list"; v: string[] };

export function resolveFacts(factSet: FactSet, compiled: CompiledIndices): Array<Resolved | undefined> {
  const out: Array<Resolved | undefined> = new Array(compiled.factTable.length).fill(undefined);
  const seen = new Set<string>();
  for (const fact of factSet.facts) {
    if (seen.has(fact.id)) continue; // duplicates: first occurrence wins (deterministic)
    seen.add(fact.id);
    const idx = compiled.factIdxById[fact.id];
    if (idx === undefined) continue; // facts unknown to the policy are ignored for evaluation
    if (fact.status === "NOT_FOUND" || fact.value === undefined) continue; // ⊥
    const decl = compiled.factTable[idx]!;
    const v = fact.value;
    switch (decl.type) {
      case "money": {
        if (typeof v !== "number") break;
        const base = compiled.fx?.base;
        if (!fact.unit || fact.unit === base) {
          out[idx] = { k: "num", v };
        } else {
          const rate = compiled.fx?.rates[fact.unit];
          if (rate !== undefined) out[idx] = { k: "num", v: v * rate };
          // unknown currency → ⊥
        }
        break;
      }
      case "number":
      case "duration":
        if (typeof v === "number") out[idx] = { k: "num", v };
        break;
      case "string":
      case "date":
        if (typeof v === "string") out[idx] = { k: "str", v };
        break;
      case "boolean":
        if (typeof v === "boolean") out[idx] = { k: "bool", v };
        break;
      case "enum": {
        if (typeof v !== "string") break;
        const ei = (decl.enumValues ?? []).indexOf(v);
        if (ei !== -1) out[idx] = { k: "enum", v: ei, s: v };
        break;
      }
      case "list":
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[idx] = { k: "list", v };
        break;
    }
  }
  return out;
}
