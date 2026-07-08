/**
 * Hand-written interfaces mirroring apps/server/openapi.json for the
 * endpoints the console actually uses. The server spec is the source of
 * truth — keep these in sync when the API changes.
 */

export type Role = "admin" | "policy_author" | "approver" | "requester" | "auditor";
export const ALL_ROLES: Role[] = ["admin", "policy_author", "approver", "requester", "auditor"];

export interface Me {
  id: string;
  kind: "human" | "agent";
  name: string;
  email: string | null;
  roles: string[];
}

// ---------- requests / documents / facts ----------

export type RequestState =
  | "extracting"
  | "facts_review"
  | "classified"
  | "pending_approval"
  | "decided"
  | "cancelled"
  | "failed";

export interface RequestSummary {
  id: string;
  title: string;
  state: string;
  requesterId: string;
  createdAt: string;
}

export interface DocumentMeta {
  id: string;
  docIndex: number;
  name: string;
  sha256: string;
  sizeBytes: number;
}

export type FactValue = string | number | boolean | string[];

export type FactStatus = "FOUND" | "NOT_FOUND" | "MANUAL";

export interface FactCitation {
  docIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface FactRow {
  factId: string;
  status: FactStatus;
  value?: FactValue | null;
  unit: string | null;
  confidence: number | null;
  citation: FactCitation | null;
  attestedBy: string | null;
}

export interface FactSet {
  id: string;
  version: number;
  status: "draft" | "confirmed";
  extractionModel: string | null;
  promptHash: string | null;
  facts: FactRow[];
}

export type MissingFacts = Array<{ category: string; facts: string[] }>;

export interface ClassificationSummary {
  id: string;
  status: "ROUTED" | "INCOMPLETE";
  tier: number | null;
  tierName: string | null;
  derivationHash: string;
  missingFacts?: MissingFacts | null;
  createdAt: string;
}

export interface Decision {
  outcome: string;
  decidedBy: string | null;
  decidedAt: string;
}

export interface RequestDetail {
  id: string;
  title: string;
  state: string;
  requesterId: string;
  policyVersionId: string;
  actionType: string | null;
  failureReason: string | null;
  createdAt: string;
  documents: DocumentMeta[];
  factSets: FactSet[];
  classifications: ClassificationSummary[];
  decision: Decision | null;
}

export interface DocumentText {
  id: string;
  name: string;
  text: string;
}

export interface PatchFactBody {
  status: FactStatus;
  value?: FactValue;
  unit?: string;
  citation?: { docIndex: number; start: number; end: number };
}

export interface ConfirmResult {
  classificationId: string;
  status: "ROUTED" | "INCOMPLETE";
  tier: number | null;
  tierName: string | null;
  routing: {
    kind: "auto_approved" | "task_created" | "incomplete";
    taskId?: string;
    quorum?: number;
    routingFailed?: boolean;
  };
  missingFacts?: MissingFacts;
}

// ---------- the derivation object (the audit artifact) ----------

export interface DerivationCitation {
  docIndex: number;
  span: [number, number];
  text: string;
}

export interface DerivationFact {
  id: string;
  status: FactStatus;
  value?: FactValue;
  unit?: string;
  confidence?: number;
  citation?: DerivationCitation;
  attestedBy?: string;
}

export interface CategoryEvaluation {
  category: string;
  handling: "scored" | "escalated_conservative" | "needs_info";
  impactBand?: string;
  bandRuleFired?: string;
  likelihoodBand?: string;
  likelihoodRulesFired?: string[];
  matrixRating?: string;
  appetiteRowApplied?: "default" | "agent_initiated";
  requiredTier?: number;
  appetiteBreached?: boolean;
  distanceFromNextBoundary?: { bands: number; direction: "above" | "below" };
  missingFacts?: string[];
}

export interface TriggerOutcome {
  id: string;
  fired: boolean;
  minTier?: number;
  tierUplift?: number;
}

export interface Composition {
  baseTier: { tier: number; bindingCategory: string };
  triggers: TriggerOutcome[];
  accumulation?: {
    countAtOrAbove: string;
    observedCount: number;
    threshold: number;
    applied: boolean;
  };
  agentUplift?: {
    appliedVia: "appetite_agent_initiated" | "default_uplift" | "none";
    selfApproveFloorApplied: boolean;
  };
  finalTier: number;
}

export interface Derivation {
  engineVersion: string;
  policy: { id: string; version: number; contentHash: string };
  subject: {
    initiatorKind: "human" | "agent";
    initiator: string;
    onBehalfOf?: string;
    actionType?: string;
  };
  documents: Array<{ name: string; sha256: string }>;
  factSet: {
    facts: DerivationFact[];
    extraction?: { model: string; promptHash: string };
  };
  categoryEvaluations: CategoryEvaluation[];
  composition?: Composition;
  explanation: string;
}

export interface ClassificationDetail {
  id: string;
  requestId: string;
  factSetId: string;
  policyVersionId: string;
  engineVersion: string;
  status: "ROUTED" | "INCOMPLETE";
  tier: number | null;
  tierName: string | null;
  derivation?: Derivation;
  derivationHash: string;
  missingFacts?: MissingFacts | null;
  createdAt: string;
}

export interface ReplayResult {
  match: boolean;
  storedHash: string;
  replayedHash: string;
  engineVersion: string;
  storedEngineVersion: string;
}

// ---------- approvals ----------

export interface InboxItem {
  id: string;
  requestId: string;
  requestTitle: string;
  classificationId: string;
  requiredTier: number;
  quorum: number;
  approvals: number;
  dueAt: string;
  escalationLevel: number;
  status: "open" | "decided" | "failed";
  routingFailed: boolean;
  myAction: string | null;
}

export interface LadderStep {
  unitId: string;
  eligible: Array<{ principalId: string; assignmentId: string; tier: number }>;
  vacantPositions: string[];
}

export interface DelegationOutcome {
  delegationId: string;
  from: string;
  to: string;
  admitted: boolean;
  reason: string;
}

export interface ResolutionTrace {
  asOf: string;
  requiredTier: number;
  quorumRule: number | "majority";
  ladder: LadderStep[];
  delegations: DelegationOutcome[];
  requesterExcluded: boolean;
  quorum: number;
  outcome: "resolved" | "no_eligible_approvers" | "quorum_unreachable";
}

export interface ApprovalTask {
  id: string;
  requestId: string;
  classificationId: string;
  requiredTier: number;
  quorum: number;
  dueAt: string;
  escalationLevel: number;
  status: "open" | "decided" | "failed";
  resolutionTrace?: ResolutionTrace | null;
  approvers: Array<{
    principalId: string;
    name: string;
    via: "position" | "delegation" | "escalation";
  }>;
  actions: Array<{
    principalId: string;
    name: string;
    action: "approve" | "reject";
    comment: string | null;
    createdAt: string;
  }>;
}

export interface ApprovalVerdict {
  verdict: "approved" | "rejected" | "pending";
  approvals: number;
  quorum: number;
}

// ---------- policies ----------

export interface PolicySummary {
  id: string;
  slug: string;
  activeVersion: number | null;
  versions: number;
}

export interface LintFinding {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  contentHash: string | null;
  findings: LintFinding[];
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  version: number;
  status: "draft" | "active" | "retired";
  contentHash: string;
  simulationRunId: string | null;
  activationOverrideReason: string | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface PolicyVersionDetail extends PolicyVersion {
  sourceYaml: string;
  findings: LintFinding[];
}

export interface DiffChange {
  path: string;
  change: "added" | "removed" | "changed";
}

// ---------- simulations ----------

export interface ReplayedOutcome {
  status: "ROUTED" | "INCOMPLETE";
  tier: number | null;
  tierName: string | null;
  missingFacts?: unknown;
}

export interface SimulationSummary {
  factSets: number;
  changed: number;
  newlyIncomplete: number;
  tierShifts: Array<{ from: number | null; to: number | null; count: number }>;
}

export interface SimulationResult {
  requestId: string;
  factSetId: string;
  changed: boolean;
  baseline?: ReplayedOutcome;
  candidate?: ReplayedOutcome;
}

export interface SimulationRun {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  baselinePolicyVersionId: string;
  candidateContentHash: string;
  summary?: SimulationSummary | null;
  createdAt: string;
  finishedAt: string | null;
  results: SimulationResult[];
}

// ---------- org ----------

export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null;
}

export interface OrgPosition {
  id: string;
  orgUnitId: string;
  title: string;
  authorityTier: number;
  holders: Array<{
    assignmentId: string;
    principalId: string;
    name: string;
    validFrom: string;
    validTo: string | null;
  }>;
}

export interface OrgDelegation {
  id: string;
  from: string;
  to: string;
  maxTier: number;
  scopeUnitId: string | null;
  validFrom: string;
  validTo: string | null;
  reason: string;
}

export interface OrgTree {
  units: OrgUnit[];
  positions: OrgPosition[];
  delegations: OrgDelegation[];
}

// ---------- audit ----------

export interface AuditEvent {
  seq: number;
  occurredAt: string;
  actor?: unknown;
  type: string;
  entity?: unknown;
  payload?: unknown;
  eventHash: string;
}

export type AuditVerifyResult =
  | { ok: true; checked: number; head: { seq: number; eventHash: string } | null }
  | { ok: false; firstBadSeq: number; reason: string };

export interface AuditCheckpoint {
  seq: number;
  eventHash: string;
  exportedAt: string;
}

// ---------- admin ----------

export interface AdminPrincipal {
  id: string;
  kind: "human" | "agent";
  name: string;
  email: string | null;
  ownerPrincipalId: string | null;
  disabled: boolean;
  roles: string[];
}

export interface AdminSettings {
  slaHoursByTier: Record<string, number>;
}
