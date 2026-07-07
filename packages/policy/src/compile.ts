/**
 * Policy compiler: YAML → schema validation → semantic lint → RFC 8785
 * canonical JSON → sha256 content hash → pre-bound integer indices.
 *
 * After compilePolicy succeeds, everything downstream (the engine) works on
 * integers and pre-parsed ASTs: no string lookups, no runtime type errors.
 */
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { canonicalize, contentHash, type JsonValue } from "./jcs.js";
import {
  bindRule,
  factIndicesOf,
  parseRule,
  RuleError,
  type BindContext,
  type FactType,
  type RuleAst,
} from "./dsl/index.js";
import type { LintFinding, RiskPolicyV1 } from "./types.js";

// ---------- compiled indices (integers only, engine-facing) ----------

export interface CompiledCategory {
  id: string;
  name: string;
  bands: Array<{ name: string; ruleSource: string; ast: RuleAst }>; // ordered; last is `else`
  requiredFactIdxs: number[];
  likelihood: {
    rules: Array<{ source: string; ast: RuleAst; minBandIdx: number }>;
    defaultBandIdx: number;
  };
  matrix: number[][]; // [impactBandIdx][likelihoodIdx] -> ratingIdx
  appetite: number[]; // [ratingIdx] -> tier
  agentAppetite?: number[];
  missingInfo: { behavior: "escalate"; conservativeBandIdx: number } | { behavior: "needs_info" };
}

export interface CompiledIndices {
  factTable: Array<{ id: string; type: FactType; enumValues?: string[] }>;
  factIdxById: Record<string, number>;
  likelihoodBands: string[];
  ratings: string[];
  ladder: Array<{ tier: number; name: string }>;
  maxTier: number;
  referenceLists: string[][];
  referenceListNames: string[];
  fx?: { base: string; rates: Record<string, number> };
  categories: CompiledCategory[];
  triggers: Array<{
    id: string;
    source: string;
    ast: RuleAst;
    rationale: string;
    minTier?: number;
    tierUplift?: number;
  }>;
  accumulation?: { ratingIdx: number; countAtOrAbove: string; threshold: number; tierUplift: number };
  agent: {
    defaultUplift: number;
    selfApproveAllowed: boolean;
    whitelist: string[];
    attestationFactIdxs: number[];
  };
}

export interface CompiledPolicy {
  policyId: string;
  version: number;
  contentHash: string;
  document: RiskPolicyV1;
  compiled: CompiledIndices;
}

export class PolicyCompileError extends Error {
  constructor(public readonly findings: LintFinding[]) {
    super(
      `policy failed to compile: ${findings
        .filter((f) => f.severity === "error")
        .map((f) => `${f.path}: ${f.message}`)
        .join("; ")}`
    );
    this.name = "PolicyCompileError";
  }
}

// ---------- schema validation ----------

const schema = JSON.parse(
  readFileSync(new URL("../schema/policy.v1.schema.json", import.meta.url), "utf8")
);
const ajv = new Ajv2020.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validateSchema = ajv.compile(schema);

// ---------- lint ----------

export function lintPolicy(doc: RiskPolicyV1): LintFinding[] {
  const findings: LintFinding[] = [];
  const err = (path: string, message: string) => findings.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => findings.push({ severity: "warning", path, message });

  // 1. authority ladder
  const ladder = doc.authority_ladder ?? [];
  ladder.forEach((entry, i) => {
    if (entry.tier !== i) err(`authority_ladder[${i}].tier`, `tiers must be contiguous from 0 (expected ${i}, got ${entry.tier})`);
  });
  if (new Set(ladder.map((l) => l.name)).size !== ladder.length)
    err("authority_ladder", "tier names must be unique");
  const maxTier = ladder.length - 1;

  const ratings = doc.rating_scale?.ratings ?? [];
  const likelihoodBands = doc.likelihood_scale?.bands ?? [];
  if (new Set(ratings).size !== ratings.length) err("rating_scale.ratings", "ratings must be unique");
  if (new Set(likelihoodBands).size !== likelihoodBands.length)
    err("likelihood_scale.bands", "likelihood bands must be unique");

  // fact + list tables for the binder
  const facts = doc.fact_schema ?? [];
  const factIds = new Set(facts.map((f) => f.id));
  if (factIds.size !== facts.length) err("fact_schema", "fact ids must be unique");
  const bindCtx: BindContext = {
    facts: new Map(
      facts.map((f, i) => [f.id, { idx: i, type: f.type as FactType, ...(f.values ? { enumValues: f.values } : {}) }])
    ),
    lists: new Map(Object.keys(doc.reference_lists ?? {}).map((name, i) => [name, i])),
  };

  const usedFactIdxs = new Set<number>();
  const usedLists = new Set<string>();
  const trackListUse = (source: string) => {
    for (const name of bindCtx.lists.keys()) {
      if (new RegExp(`\\bin\\s+${name}\\b`).test(source)) usedLists.add(name);
    }
  };
  const bindOrReport = (source: string, path: string, allowElse: boolean): RuleAst | null => {
    try {
      const ast = bindRule(parseRule(source), bindCtx, { allowElse });
      factIndicesOf(ast).forEach((i) => usedFactIdxs.add(i));
      trackListUse(source);
      return ast;
    } catch (e) {
      if (e instanceof RuleError) {
        err(path, e.message);
        return null;
      }
      throw e;
    }
  };

  // 2–8. categories
  (doc.categories ?? []).forEach((cat, ci) => {
    const base = `categories[${ci}]`;
    const bands = cat.impact_scale?.bands ?? [];
    const bandNames = bands.map((b) => b.name);
    if (new Set(bandNames).size !== bandNames.length) err(`${base}.impact_scale.bands`, "band names must be unique");

    // 5. band rules: parse/bind; exactly one else, last
    const elsePositions = bands.map((b, i) => (b.rule.trim() === "else" ? i : -1)).filter((i) => i >= 0);
    if (elsePositions.length !== 1 || elsePositions[0] !== bands.length - 1)
      err(`${base}.impact_scale.bands`, "exactly one 'else' band is required and it must be last (the scale must be exhaustive)");
    bands.forEach((b, bi) => {
      bindOrReport(b.rule, `${base}.impact_scale.bands[${bi}].rule`, bi === bands.length - 1);
    });

    // 6. required facts declared
    (cat.impact_scale?.required_facts ?? []).forEach((f, fi) => {
      if (!factIds.has(f)) err(`${base}.impact_scale.required_facts[${fi}]`, `unknown fact '${f}'`);
      else usedFactIdxs.add(bindCtx.facts.get(f)!.idx);
    });

    // 7. likelihood rules
    const lrules = cat.likelihood_rules ?? [];
    const defaults = lrules.filter((r) => "default_band" in r);
    if (defaults.length !== 1 || !("default_band" in (lrules[lrules.length - 1] ?? {})))
      err(`${base}.likelihood_rules`, "exactly one {default_band} entry is required and it must be last");
    lrules.forEach((r, ri) => {
      if ("min_band" in r) {
        if (!likelihoodBands.includes(r.min_band)) err(`${base}.likelihood_rules[${ri}].min_band`, `unknown likelihood band '${r.min_band}'`);
        if (r.if.trim() === "else") err(`${base}.likelihood_rules[${ri}].if`, "'else' is not allowed in likelihood rules");
        else bindOrReport(r.if, `${base}.likelihood_rules[${ri}].if`, false);
      } else if (!likelihoodBands.includes(r.default_band)) {
        err(`${base}.likelihood_rules[${ri}].default_band`, `unknown likelihood band '${r.default_band}'`);
      }
    });

    // 4. matrix shape + monotone both axes
    const matrix = cat.risk_matrix ?? {};
    const matrixKeys = Object.keys(matrix);
    const missingRows = bandNames.filter((b) => !matrixKeys.includes(b));
    const extraRows = matrixKeys.filter((k) => !bandNames.includes(k));
    if (missingRows.length) err(`${base}.risk_matrix`, `missing rows for impact bands: ${missingRows.join(", ")}`);
    if (extraRows.length) err(`${base}.risk_matrix`, `rows for undeclared impact bands: ${extraRows.join(", ")}`);
    const ratingIdx = (r: string) => ratings.indexOf(r);
    bandNames.forEach((band) => {
      const row = matrix[band];
      if (!row) return;
      if (row.length !== likelihoodBands.length)
        err(`${base}.risk_matrix.${band}`, `expected ${likelihoodBands.length} cells (one per likelihood band), got ${row.length}`);
      row.forEach((cell, li) => {
        if (ratingIdx(cell) === -1) err(`${base}.risk_matrix.${band}[${li}]`, `unknown rating '${cell}'`);
      });
      for (let li = 1; li < row.length; li++) {
        if (ratingIdx(row[li]!) < ratingIdx(row[li - 1]!))
          err(`${base}.risk_matrix.${band}`, `row must be non-decreasing along likelihood (cell ${li} '${row[li]}' < '${row[li - 1]}')`);
      }
    });
    for (let bi = 1; bi < bandNames.length; bi++) {
      const above = matrix[bandNames[bi - 1]!];
      const below = matrix[bandNames[bi]!];
      if (!above || !below || above.length !== below.length) continue;
      for (let li = 0; li < below.length; li++) {
        if (ratingIdx(below[li]!) < ratingIdx(above[li]!))
          err(`${base}.risk_matrix.${bandNames[bi]}`, `column ${li} must be non-decreasing with impact severity ('${below[li]}' < '${above[li]}')`);
      }
    }

    // 2. appetite totality + monotone; 3. agent appetite
    const checkAppetite = (appetite: Record<string, number> | undefined, path: string, floor?: Record<string, number>) => {
      if (!appetite) return;
      const keys = Object.keys(appetite);
      const missing = ratings.filter((r) => !keys.includes(r));
      const unknown = keys.filter((k) => !ratings.includes(k));
      if (missing.length) err(path, `missing ratings: ${missing.join(", ")}`);
      if (unknown.length) err(path, `unknown ratings: ${unknown.join(", ")}`);
      let prev = -1;
      for (const r of ratings) {
        const t = appetite[r];
        if (t === undefined) continue;
        if (t < 0 || t > maxTier) err(`${path}.${r}`, `tier ${t} outside ladder [0, ${maxTier}]`);
        if (t < prev) err(`${path}.${r}`, `appetite must be non-decreasing in rating severity (${t} < ${prev})`);
        prev = Math.max(prev, t);
        if (floor && floor[r] !== undefined && t < floor[r]!)
          err(`${path}.${r}`, `agent-initiated appetite (${t}) must be >= default appetite (${floor[r]}) for the same rating`);
      }
    };
    checkAppetite(cat.appetite, `${base}.appetite`);
    checkAppetite(cat.appetite_agent_initiated, `${base}.appetite_agent_initiated`, cat.appetite);

    // 8. missing_info
    if (cat.missing_info.behavior === "escalate" && !bandNames.includes(cat.missing_info.conservative_band))
      err(`${base}.missing_info.conservative_band`, `'${cat.missing_info.conservative_band}' is not an impact band of this category`);
  });
  if (new Set((doc.categories ?? []).map((c) => c.id)).size !== (doc.categories ?? []).length)
    err("categories", "category ids must be unique");

  // 9. triggers
  const triggers = doc.escalation_triggers ?? [];
  if (new Set(triggers.map((t) => t.id)).size !== triggers.length) err("escalation_triggers", "trigger ids must be unique");
  triggers.forEach((t, ti) => {
    if (t.rule.trim() === "else") err(`escalation_triggers[${ti}].rule`, "'else' is not allowed in triggers");
    else bindOrReport(t.rule, `escalation_triggers[${ti}].rule`, false);
    if (t.min_tier !== undefined && (t.min_tier < 0 || t.min_tier > maxTier))
      err(`escalation_triggers[${ti}].min_tier`, `tier ${t.min_tier} outside ladder [0, ${maxTier}]`);
    if (t.min_tier === 0) warn(`escalation_triggers[${ti}].min_tier`, "min_tier 0 never changes routing");
  });

  // 10. accumulation
  if (doc.accumulation_rule && !ratings.includes(doc.accumulation_rule.count_at_or_above))
    err("accumulation_rule.count_at_or_above", `unknown rating '${doc.accumulation_rule.count_at_or_above}'`);
  if (doc.accumulation_rule && doc.accumulation_rule.threshold > (doc.categories ?? []).length)
    warn("accumulation_rule.threshold", `threshold ${doc.accumulation_rule.threshold} exceeds the ${(doc.categories ?? []).length} categories — the rule can never fire`);

  // 11. attestation facts
  (doc.agent_policy?.attestation_required_facts ?? []).forEach((f, fi) => {
    if (!factIds.has(f)) err(`agent_policy.attestation_required_facts[${fi}]`, `unknown fact '${f}'`);
    else usedFactIdxs.add(bindCtx.facts.get(f)!.idx);
  });

  // 12. money facts require fx and base-currency units
  const moneyFacts = facts.filter((f) => f.type === "money");
  if (moneyFacts.length > 0) {
    if (!doc.fx_snapshot) err("fx_snapshot", "policies with money facts must pin an fx_snapshot");
    else
      moneyFacts.forEach((f) => {
        if (f.unit && f.unit !== doc.fx_snapshot!.base_currency)
          err(`fact_schema(${f.id}).unit`, `money facts must be declared in the base currency ${doc.fx_snapshot!.base_currency} (rule literals are base-currency by construction)`);
      });
  }

  // warnings: unused facts / lists / agent uplift default
  facts.forEach((f, i) => {
    if (!usedFactIdxs.has(i)) warn(`fact_schema(${f.id})`, "fact is declared but never referenced by any rule, required_facts, or attestation");
  });
  for (const name of bindCtx.lists.keys()) {
    if (!usedLists.has(name)) warn(`reference_lists.${name}`, "reference list is never used by any rule");
  }
  const anyAgentColumn = (doc.categories ?? []).some((c) => c.appetite_agent_initiated);
  if (!anyAgentColumn && doc.agent_policy?.default_uplift === undefined)
    warn("agent_policy.default_uplift", "no category has an agent-initiated appetite column and default_uplift is unset — agent actions get no uplift (+0)");

  return findings;
}

// ---------- indices ----------

function buildIndices(doc: RiskPolicyV1): CompiledIndices {
  const factTable = doc.fact_schema.map((f) => ({
    id: f.id,
    type: f.type as FactType,
    ...(f.values ? { enumValues: f.values } : {}),
  }));
  const factIdxById = Object.fromEntries(factTable.map((f, i) => [f.id, i]));
  const listNames = Object.keys(doc.reference_lists ?? {});
  const bindCtx: BindContext = {
    facts: new Map(factTable.map((f, i) => [f.id, { idx: i, type: f.type, ...(f.enumValues ? { enumValues: f.enumValues } : {}) }])),
    lists: new Map(listNames.map((n, i) => [n, i])),
  };
  const ratings = doc.rating_scale.ratings;
  const likelihoodBands = doc.likelihood_scale.bands;

  const categories: CompiledCategory[] = doc.categories.map((cat) => {
    const bandNames = cat.impact_scale.bands.map((b) => b.name);
    return {
      id: cat.id,
      name: cat.name ?? cat.id,
      bands: cat.impact_scale.bands.map((b, bi) => ({
        name: b.name,
        ruleSource: b.rule,
        ast: bindRule(parseRule(b.rule), bindCtx, { allowElse: bi === cat.impact_scale.bands.length - 1 }),
      })),
      requiredFactIdxs: (cat.impact_scale.required_facts ?? []).map((f) => factIdxById[f]!),
      likelihood: {
        rules: (cat.likelihood_rules ?? [])
          .filter((r): r is { if: string; min_band: string } => "min_band" in r)
          .map((r) => ({
            source: r.if,
            ast: bindRule(parseRule(r.if), bindCtx, { allowElse: false }),
            minBandIdx: likelihoodBands.indexOf(r.min_band),
          })),
        defaultBandIdx: likelihoodBands.indexOf(
          (cat.likelihood_rules ?? []).filter((r): r is { default_band: string } => "default_band" in r)[0]?.default_band ??
            likelihoodBands[0]!
        ),
      },
      matrix: bandNames.map((band) => cat.risk_matrix[band]!.map((cell) => ratings.indexOf(cell))),
      appetite: ratings.map((r) => cat.appetite[r]!),
      ...(cat.appetite_agent_initiated
        ? { agentAppetite: ratings.map((r) => cat.appetite_agent_initiated![r]!) }
        : {}),
      missingInfo:
        cat.missing_info.behavior === "escalate"
          ? { behavior: "escalate", conservativeBandIdx: bandNames.indexOf(cat.missing_info.conservative_band) }
          : { behavior: "needs_info" },
    };
  });

  return {
    factTable,
    factIdxById,
    likelihoodBands,
    ratings,
    ladder: doc.authority_ladder.map((l) => ({ tier: l.tier, name: l.name })),
    maxTier: doc.authority_ladder.length - 1,
    referenceLists: listNames.map((n) => doc.reference_lists![n]!),
    referenceListNames: listNames,
    ...(doc.fx_snapshot ? { fx: { base: doc.fx_snapshot.base_currency, rates: doc.fx_snapshot.rates } } : {}),
    categories,
    triggers: (doc.escalation_triggers ?? []).map((t) => ({
      id: t.id,
      source: t.rule,
      ast: bindRule(parseRule(t.rule), bindCtx, { allowElse: false }),
      rationale: t.rationale,
      ...(t.min_tier !== undefined ? { minTier: t.min_tier } : {}),
      ...(t.tier_uplift !== undefined ? { tierUplift: t.tier_uplift } : {}),
    })),
    ...(doc.accumulation_rule
      ? {
          accumulation: {
            ratingIdx: ratings.indexOf(doc.accumulation_rule.count_at_or_above),
            countAtOrAbove: doc.accumulation_rule.count_at_or_above,
            threshold: doc.accumulation_rule.threshold,
            tierUplift: doc.accumulation_rule.tier_uplift,
          },
        }
      : {}),
    agent: {
      defaultUplift: doc.agent_policy.default_uplift ?? 0,
      selfApproveAllowed: doc.agent_policy.self_approve_allowed,
      whitelist: doc.agent_policy.self_approve_whitelist ?? [],
      attestationFactIdxs: (doc.agent_policy.attestation_required_facts ?? []).map((f) => factIdxById[f]!),
    },
  };
}

// ---------- entry points ----------

/** Compile an already-parsed document (schema-shape unknown → validated here). */
export function compileDocument(raw: unknown): CompiledPolicy {
  if (!validateSchema(raw)) {
    const findings: LintFinding[] = (validateSchema.errors ?? []).map((e) => ({
      severity: "error",
      path: e.instancePath || "(root)",
      message: e.message ?? "schema violation",
    }));
    throw new PolicyCompileError(findings);
  }
  const doc = raw as RiskPolicyV1;
  const findings = lintPolicy(doc);
  if (findings.some((f) => f.severity === "error")) throw new PolicyCompileError(findings);
  return {
    policyId: doc.policy_id,
    version: doc.version,
    contentHash: contentHash(doc as unknown as JsonValue),
    document: doc,
    compiled: buildIndices(doc),
  };
}

/** YAML source → CompiledPolicy. The canonical JSON bytes are the policy identity. */
export function compilePolicy(yamlSource: string): CompiledPolicy {
  return compileDocument(parseYaml(yamlSource));
}

/** The canonical bytes (what gets stored and hashed). */
export function canonicalBytes(doc: RiskPolicyV1): string {
  return canonicalize(doc as unknown as JsonValue);
}
