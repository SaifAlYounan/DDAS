/**
 * The CLOSED union of audit event types. Emitting an unlisted type is a
 * compile error — extending the audit surface is a deliberate, reviewed act.
 */
export const AUDIT_EVENT_TYPES = [
  // identity & org
  "principal.created",
  "principal.updated",
  "principal.disabled",
  "principal.enabled",
  "role.granted",
  "role.revoked",
  // custom roles (ADR 0005) — definition lifecycle + membership grant.
  // Membership revocation reuses "role.revoked" (payload carries customRoleId).
  "role.created",
  "role.updated",
  "role.deleted",
  "role.assigned",
  "org_unit.created",
  "org_unit.updated",
  "position.created",
  "position.updated",
  "position_assignment.created",
  "position_assignment.ended",
  "delegation.created",
  "delegation.revoked",
  "org.imported",
  // auth
  "session.login",
  "session.login_failed",
  "session.logout",
  "principal.password_changed",
  "api_key.created",
  "api_key.revoked",
  "admin.bootstrap",
  // policy lifecycle
  "policy.created",
  "policy_version.drafted",
  "policy_version.activated",
  "policy_version.retired",
  // request pipeline
  "request.submitted",
  "request.state_changed",
  "request.cancelled",
  "request.failed",
  "document.uploaded",
  "extraction.started",
  "extraction.completed",
  "extraction.failed",
  "fact.corrected",
  "fact.attested",
  "fact_set.confirmed",
  "classification.created",
  "classification.replayed",
  // approvals
  "approval_task.created",
  "approval_task.escalated",
  "approval_task.routing_failed",
  "approval.approved",
  "approval.rejected",
  "decision.recorded",
  // simulation
  "simulation.started",
  "simulation.completed",
  "simulation.failed",
  // integration
  "webhook.created",
  "webhook.deleted",
  "webhook.delivery_dead",
  "mcp.call",
  // settings & audit itself
  "settings.updated",
  "audit.checkpoint_exported",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditActor =
  | { kind: "system" }
  | { kind: "principal"; id: string }
  | { kind: "api_key"; id: string; principalId: string };

export interface AuditEntity {
  type: string;
  id: string;
}

export interface NewAuditEvent {
  actor: AuditActor;
  type: AuditEventType;
  entity: AuditEntity;
  payload: Record<string, unknown>;
}
