/**
 * @ddas/policy — policy-as-code.
 *
 * Phase 0 ships the CONTRACT: the JSON Schema (schema/policy.v1.schema.json),
 * the starter template, and the TypeScript shapes below. Phase 1 fills in the
 * compiler (YAML → RFC 8785 canonical JSON + sha256 content hash) and the
 * semantic linter (monotone appetites, matrices monotone on both axes,
 * exhaustive ordered bands, every referenced fact declared).
 */

export const POLICY_SCHEMA_VERSION = 1 as const;

/** TypeScript mirror of schema/policy.v1.schema.json. */
export interface RiskPolicyV1 {
  schema_version: 1;
  policy_id: string;
  name: string;
  version: number;
  effective_from: string;
  approved_by?: { role: string; name?: string; date?: string };
  authority_ladder: Array<{
    tier: number;
    name: string;
    roles?: string[];
    quorum?: number | "majority";
  }>;
  likelihood_scale: { bands: string[] };
  rating_scale: { ratings: string[] };
  fact_schema: Array<{
    id: string;
    type: "money" | "number" | "string" | "boolean" | "date" | "duration" | "enum" | "list";
    unit?: string;
    values?: string[];
    description?: string;
  }>;
  categories: Array<{
    id: string;
    name?: string;
    impact_scale: {
      bands: Array<{ name: string; rule: string; description?: string }>;
      required_facts?: string[];
    };
    likelihood_rules?: Array<
      { if: string; min_band: string } | { default_band: string }
    >;
    risk_matrix: Record<string, string[]>;
    appetite: Record<string, number>;
    appetite_agent_initiated?: Record<string, number>;
    missing_info:
      | { behavior: "escalate"; conservative_band: string }
      | { behavior: "needs_info" };
  }>;
  escalation_triggers?: Array<{
    id: string;
    rule: string;
    rationale: string;
    min_tier?: number;
    tier_uplift?: number;
  }>;
  accumulation_rule?: {
    count_at_or_above: string;
    threshold: number;
    tier_uplift: number;
  };
  agent_policy: {
    default_uplift?: number;
    self_approve_allowed: boolean;
    self_approve_whitelist?: string[];
    attestation_required_facts?: string[];
  };
  reference_lists?: Record<string, string[]>;
  fx_snapshot?: {
    base_currency: string;
    as_of: string;
    rates: Record<string, number>;
  };
}

/**
 * A registered, immutable policy version — the engine's second input.
 * `contentHash` is sha256 over the RFC 8785 canonical JSON and is the policy's
 * identity in every classification derivation.
 */
export interface CompiledPolicy {
  policyId: string;
  version: number;
  contentHash: string;
  document: RiskPolicyV1;
}

export interface LintFinding {
  severity: "error" | "warning";
  path: string;
  message: string;
}

/** Phase 1: YAML source → validated, canonicalized, hashed CompiledPolicy. */
export function compilePolicy(_yamlSource: string): CompiledPolicy {
  throw new Error("Not implemented — Phase 1 (see docs/adr/0004-acos-risk-model.md)");
}

/** Phase 1: semantic validation beyond the JSON Schema. */
export function lintPolicy(_document: RiskPolicyV1): LintFinding[] {
  throw new Error("Not implemented — Phase 1 (see docs/adr/0004-acos-risk-model.md)");
}
