/**
 * The DDAS data model. Immutability at the decision-critical layer is enforced
 * IN POSTGRES (triggers in migrations/0001_immutability.sql), not in app code:
 * audit_events / classifications / decisions / approval_actions are INSERT-only,
 * policy_versions freeze once they leave draft, fact_sets freeze once confirmed.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

export const principalKind = pgEnum("principal_kind", ["human", "agent"]);
export const roleName = pgEnum("role_name", [
  "admin",
  "policy_author",
  "approver",
  "requester",
  "auditor",
  "viewer",
]);
export const policyVersionStatus = pgEnum("policy_version_status", [
  "draft",
  "active",
  "retired",
]);
export const requestState = pgEnum("request_state", [
  "extracting",
  "facts_review",
  "classified",
  "pending_approval",
  "decided",
  "cancelled",
  "failed",
]);
export const factSetStatus = pgEnum("fact_set_status", ["draft", "confirmed"]);
export const factStatus = pgEnum("fact_status", ["FOUND", "NOT_FOUND", "MANUAL"]);
export const classificationStatus = pgEnum("classification_status", [
  "ROUTED",
  "INCOMPLETE",
]);
export const approvalTaskStatus = pgEnum("approval_task_status", [
  "open",
  "decided",
  "failed",
]);
export const approverVia = pgEnum("approver_via", [
  "position",
  "delegation",
  "escalation",
]);
export const approvalAction = pgEnum("approval_action", ["approve", "reject"]);
export const decisionOutcome = pgEnum("decision_outcome", [
  "approved",
  "rejected",
  "auto_approved",
]);
export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "dead",
]);
export const simulationRunStatus = pgEnum("simulation_run_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

// ---------- identity / org ----------

export const principals = pgTable(
  "principals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: principalKind("kind").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    /** Agents point at their accountable human owner. */
    ownerPrincipalId: uuid("owner_principal_id"),
    oidcIssuer: text("oidc_issuer"),
    oidcSubject: text("oidc_subject"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("principals_email_uq").on(t.email),
    uniqueIndex("principals_oidc_uq").on(t.oidcIssuer, t.oidcSubject),
    check(
      "principals_agent_has_owner",
      sql`${t.kind} <> 'agent' OR ${t.ownerPrincipalId} IS NOT NULL`
    ),
  ]
);

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    role: roleName("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("role_assignments_uq").on(t.principalId, t.role)]
);

export const orgUnits = pgTable("org_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnits.id),
    title: text("title").notNull(),
    authorityTier: integer("authority_tier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("positions_tier_nonneg", sql`${t.authorityTier} >= 0`)]
);

/** Temporal validity IS the absence model: no assignment row live at asOf = vacant. */
export const positionAssignments = pgTable(
  "position_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("position_assignments_position_idx").on(t.positionId),
    check(
      "position_assignments_window",
      sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`
    ),
  ]
);

export const delegations = pgTable(
  "delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPrincipalId: uuid("from_principal_id")
      .notNull()
      .references(() => principals.id),
    toPrincipalId: uuid("to_principal_id")
      .notNull()
      .references(() => principals.id),
    /** Ceiling: the delegate may approve up to this tier, never above. */
    maxTier: integer("max_tier").notNull(),
    /** Optional subtree scope; NULL = wherever the delegator is eligible. */
    orgUnitScopeId: uuid("org_unit_scope_id").references(() => orgUnits.id),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("delegations_not_self", sql`${t.fromPrincipalId} <> ${t.toPrincipalId}`),
    check(
      "delegations_window",
      sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`
    ),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    tokenSha256: text("token_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenSha256)]
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    prefix: text("prefix").notNull(),
    keySha256: text("key_sha256").notNull(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_prefix_uq").on(t.prefix)]
);

// ---------- policy ----------

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("policies_slug_uq").on(t.slug)]
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    version: integer("version").notNull(),
    status: policyVersionStatus("status").notNull().default("draft"),
    sourceYaml: text("source_yaml").notNull(),
    canonicalJson: jsonb("canonical_json").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Activation requires a simulation run OR an explicit, audited override. */
    simulationRunId: uuid("simulation_run_id"),
    activationOverrideReason: text("activation_override_reason"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("policy_versions_uq").on(t.policyId, t.version),
    uniqueIndex("policy_versions_one_active_uq")
      .on(t.policyId)
      .where(sql`${t.status} = 'active'`),
    check(
      "policy_versions_activation_gate",
      sql`${t.status} <> 'active' OR ${t.simulationRunId} IS NOT NULL OR ${t.activationOverrideReason} IS NOT NULL`
    ),
  ]
);

// ---------- requests / documents / facts ----------

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => principals.id),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id),
    title: text("title").notNull(),
    actionType: text("action_type"),
    state: requestState("state").notNull().default("extracting"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("requests_state_idx").on(t.state)]
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    /** Order within the request — the docIndex citations point into. */
    docIndex: integer("doc_index").notNull(),
    name: text("name").notNull(),
    sha256: text("sha256").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Kept in-db so the citation highlighter never re-reads the blob. */
    extractedText: text("extracted_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documents_request_index_uq").on(t.requestId, t.docIndex)]
);

export const factSets = pgTable(
  "fact_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    version: integer("version").notNull(),
    status: factSetStatus("status").notNull().default("draft"),
    extractionModel: text("extraction_model"),
    promptHash: text("prompt_hash"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fact_sets_request_version_uq").on(t.requestId, t.version)]
);

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    factSetId: uuid("fact_set_id")
      .notNull()
      .references(() => factSets.id),
    /** The policy's declared fact id this row instantiates. */
    factId: text("fact_id").notNull(),
    status: factStatus("status").notNull(),
    value: jsonb("value"),
    unit: text("unit"),
    confidence: real("confidence"),
    citationDocIndex: integer("citation_doc_index"),
    citationStart: integer("citation_start"),
    citationEnd: integer("citation_end"),
    citationText: text("citation_text"),
    /** Set when a human enters/overrides the value (status MANUAL). */
    attestedBy: uuid("attested_by").references(() => principals.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("facts_set_fact_uq").on(t.factSetId, t.factId),
    check(
      "facts_found_has_citation",
      sql`${t.status} <> 'FOUND' OR (${t.value} IS NOT NULL AND ${t.citationText} IS NOT NULL)`
    ),
    check(
      "facts_manual_attested",
      sql`${t.status} <> 'MANUAL' OR (${t.value} IS NOT NULL AND ${t.attestedBy} IS NOT NULL)`
    ),
    check("facts_not_found_bare", sql`${t.status} <> 'NOT_FOUND' OR ${t.value} IS NULL`),
  ]
);

// ---------- decisions ----------

export const classifications = pgTable(
  "classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    factSetId: uuid("fact_set_id")
      .notNull()
      .references(() => factSets.id),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id),
    engineVersion: text("engine_version").notNull(),
    status: classificationStatus("status").notNull(),
    tier: integer("tier"),
    tierName: text("tier_name"),
    derivation: jsonb("derivation").notNull(),
    /** sha256(JCS(derivation)) — the replay target. */
    derivationHash: text("derivation_hash").notNull(),
    missingFacts: jsonb("missing_facts"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("classifications_request_idx").on(t.requestId)]
);

export const approvalTasks = pgTable(
  "approval_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    classificationId: uuid("classification_id")
      .notNull()
      .references(() => classifications.id),
    requiredTier: integer("required_tier").notNull(),
    quorum: integer("quorum").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    escalationLevel: integer("escalation_level").notNull().default(0),
    status: approvalTaskStatus("status").notNull().default("open"),
    /** The routing resolver's full trace — routing explains itself like classification. */
    resolutionTrace: jsonb("resolution_trace").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_tasks_status_idx").on(t.status)]
);

/** Eligibility SNAPSHOT at resolution time — who may act, and via what authority. */
export const approvalTaskApprovers = pgTable(
  "approval_task_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => approvalTasks.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    via: approverVia("via").notNull(),
    /** position_assignments.id | delegations.id | NULL for escalation. */
    sourceId: uuid("source_id"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("approval_task_approvers_uq").on(t.taskId, t.principalId)]
);

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => approvalTasks.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    action: approvalAction("action").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_actions_uq").on(t.taskId, t.principalId),
    check(
      "approval_actions_reject_comment",
      sql`${t.action} <> 'reject' OR ${t.comment} IS NOT NULL`
    ),
  ]
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    taskId: uuid("task_id").references(() => approvalTasks.id),
    outcome: decisionOutcome("outcome").notNull(),
    decidedBy: uuid("decided_by").references(() => principals.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("decisions_request_uq").on(t.requestId)]
);

// ---------- audit ----------

export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actor: jsonb("actor").notNull(),
    type: text("type").notNull(),
    entity: jsonb("entity").notNull(),
    payload: jsonb("payload").notNull(),
    prevHash: text("prev_hash").notNull(),
    eventHash: text("event_hash").notNull(),
  },
  (t) => [uniqueIndex("audit_events_hash_uq").on(t.eventHash)]
);

// ---------- integration ----------

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id),
  eventSeq: bigint("event_seq", { mode: "number" })
    .notNull()
    .references(() => auditEvents.seq),
  status: webhookDeliveryStatus("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- simulation ----------

export const simulationRuns = pgTable("simulation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  baselinePolicyVersionId: uuid("baseline_policy_version_id")
    .notNull()
    .references(() => policyVersions.id),
  candidateSourceYaml: text("candidate_source_yaml").notNull(),
  candidateContentHash: text("candidate_content_hash").notNull(),
  status: simulationRunStatus("status").notNull().default("pending"),
  summary: jsonb("summary"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => principals.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const simulationResults = pgTable(
  "simulation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => simulationRuns.id),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    factSetId: uuid("fact_set_id")
      .notNull()
      .references(() => factSets.id),
    baseline: jsonb("baseline").notNull(),
    candidate: jsonb("candidate").notNull(),
    changed: boolean("changed").notNull(),
  },
  (t) => [uniqueIndex("simulation_results_uq").on(t.runId, t.requestId)]
);

// ---------- settings ----------

/** Single-row settings table (id must be TRUE). */
export const orgSettings = pgTable(
  "org_settings",
  {
    id: boolean("id").primaryKey().default(true),
    /** { "0": 4, "1": 8, ... } — SLA hours by required tier. */
    slaHoursByTier: jsonb("sla_hours_by_tier").notNull(),
  },
  (t) => [check("org_settings_singleton", sql`${t.id} = TRUE`)]
);
