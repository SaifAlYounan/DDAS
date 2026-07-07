/**
 * @ddas/policy — policy-as-code.
 *
 * The RiskPolicy JSON Schema (schema/policy.v1.schema.json) is the published
 * contract; this package compiles YAML policies against it: structural
 * validation (ajv) → semantic lint → RFC 8785 canonical JSON → sha256 content
 * hash → pre-bound integer indices the engine evaluates without any string
 * work. See docs/adr/0004-acos-risk-model.md.
 */

export const POLICY_SCHEMA_VERSION = 1 as const;

export type { LintFinding, RiskPolicyV1 } from "./types.js";
export {
  canonicalBytes,
  compileDocument,
  compilePolicy,
  lintPolicy,
  PolicyCompileError,
  type CompiledCategory,
  type CompiledIndices,
  type CompiledPolicy,
} from "./compile.js";
export { canonicalize, contentHash, type JsonValue } from "./jcs.js";
export {
  bindRule,
  factIndicesOf,
  parseRule,
  RuleError,
  tokenize,
  type BindContext,
  type CmpOp,
  type FactType,
  type Lit,
  type RuleAst,
} from "./dsl/index.js";
