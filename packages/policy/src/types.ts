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

export interface LintFinding {
  severity: "error" | "warning";
  path: string;
  message: string;
}
