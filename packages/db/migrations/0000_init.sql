CREATE TYPE "public"."approval_action" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."approval_task_status" AS ENUM('open', 'decided', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approver_via" AS ENUM('position', 'delegation', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."classification_status" AS ENUM('ROUTED', 'INCOMPLETE');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('approved', 'rejected', 'auto_approved');--> statement-breakpoint
CREATE TYPE "public"."fact_set_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('FOUND', 'NOT_FOUND', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."policy_version_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('extracting', 'facts_review', 'classified', 'pending_approval', 'decided', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('admin', 'policy_author', 'approver', 'requester', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."simulation_run_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'dead');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"key_sha256" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"action" "approval_action" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_actions_reject_comment" CHECK ("approval_actions"."action" <> 'reject' OR "approval_actions"."comment" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "approval_task_approvers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"via" "approver_via" NOT NULL,
	"source_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"classification_id" uuid NOT NULL,
	"required_tier" integer NOT NULL,
	"quorum" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"status" "approval_task_status" DEFAULT 'open' NOT NULL,
	"resolution_trace" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" jsonb NOT NULL,
	"type" text NOT NULL,
	"entity" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"event_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"fact_set_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"status" "classification_status" NOT NULL,
	"tier" integer,
	"tier_name" text,
	"derivation" jsonb NOT NULL,
	"derivation_hash" text NOT NULL,
	"missing_facts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"task_id" uuid,
	"outcome" "decision_outcome" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_principal_id" uuid NOT NULL,
	"to_principal_id" uuid NOT NULL,
	"max_tier" integer NOT NULL,
	"org_unit_scope_id" uuid,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegations_not_self" CHECK ("delegations"."from_principal_id" <> "delegations"."to_principal_id"),
	CONSTRAINT "delegations_window" CHECK ("delegations"."valid_to" IS NULL OR "delegations"."valid_to" > "delegations"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"doc_index" integer NOT NULL,
	"name" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"extracted_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "fact_set_status" DEFAULT 'draft' NOT NULL,
	"extraction_model" text,
	"prompt_hash" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact_set_id" uuid NOT NULL,
	"fact_id" text NOT NULL,
	"status" "fact_status" NOT NULL,
	"value" jsonb,
	"unit" text,
	"confidence" real,
	"citation_doc_index" integer,
	"citation_start" integer,
	"citation_end" integer,
	"citation_text" text,
	"attested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_found_has_citation" CHECK ("facts"."status" <> 'FOUND' OR ("facts"."value" IS NOT NULL AND "facts"."citation_text" IS NOT NULL)),
	CONSTRAINT "facts_manual_attested" CHECK ("facts"."status" <> 'MANUAL' OR ("facts"."value" IS NOT NULL AND "facts"."attested_by" IS NOT NULL)),
	CONSTRAINT "facts_not_found_bare" CHECK ("facts"."status" <> 'NOT_FOUND' OR "facts"."value" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"sla_hours_by_tier" jsonb NOT NULL,
	CONSTRAINT "org_settings_singleton" CHECK ("org_settings"."id" = TRUE)
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "policy_version_status" DEFAULT 'draft' NOT NULL,
	"source_yaml" text NOT NULL,
	"canonical_json" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"simulation_run_id" uuid,
	"activation_override_reason" text,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_activation_gate" CHECK ("policy_versions"."status" <> 'active' OR "policy_versions"."simulation_run_id" IS NOT NULL OR "policy_versions"."activation_override_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "position_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_assignments_window" CHECK ("position_assignments"."valid_to" IS NULL OR "position_assignments"."valid_to" > "position_assignments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"title" text NOT NULL,
	"authority_tier" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_tier_nonneg" CHECK ("positions"."authority_tier" >= 0)
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "principal_kind" NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"password_hash" text,
	"owner_principal_id" uuid,
	"oidc_issuer" text,
	"oidc_subject" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_agent_has_owner" CHECK ("principals"."kind" <> 'agent' OR "principals"."owner_principal_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"action_type" text,
	"state" "request_state" DEFAULT 'extracting' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" "role_name" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"token_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fact_set_id" uuid NOT NULL,
	"baseline" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"changed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_policy_version_id" uuid NOT NULL,
	"candidate_source_yaml" text NOT NULL,
	"candidate_content_hash" text NOT NULL,
	"status" "simulation_run_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_seq" bigint NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_task_id_approval_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."approval_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_task_approvers" ADD CONSTRAINT "approval_task_approvers_task_id_approval_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."approval_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_task_approvers" ADD CONSTRAINT "approval_task_approvers_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_classification_id_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."classifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_fact_set_id_fact_sets_id_fk" FOREIGN KEY ("fact_set_id") REFERENCES "public"."fact_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_approval_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."approval_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_principals_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_from_principal_id_principals_id_fk" FOREIGN KEY ("from_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_to_principal_id_principals_id_fk" FOREIGN KEY ("to_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_org_unit_scope_id_org_units_id_fk" FOREIGN KEY ("org_unit_scope_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sets" ADD CONSTRAINT "fact_sets_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_sets" ADD CONSTRAINT "fact_sets_confirmed_by_principals_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_fact_set_id_fact_sets_id_fk" FOREIGN KEY ("fact_set_id") REFERENCES "public"."fact_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_attested_by_principals_id_fk" FOREIGN KEY ("attested_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_assignments" ADD CONSTRAINT "position_assignments_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_principals_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_fact_set_id_fact_sets_id_fk" FOREIGN KEY ("fact_set_id") REFERENCES "public"."fact_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_baseline_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("baseline_policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_created_by_principals_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_seq_audit_events_seq_fk" FOREIGN KEY ("event_seq") REFERENCES "public"."audit_events"("seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uq" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_actions_uq" ON "approval_actions" USING btree ("task_id","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_task_approvers_uq" ON "approval_task_approvers" USING btree ("task_id","principal_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_status_idx" ON "approval_tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_hash_uq" ON "audit_events" USING btree ("event_hash");--> statement-breakpoint
CREATE INDEX "classifications_request_idx" ON "classifications" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_request_uq" ON "decisions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_request_index_uq" ON "documents" USING btree ("request_id","doc_index");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_sets_request_version_uq" ON "fact_sets" USING btree ("request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "facts_set_fact_uq" ON "facts" USING btree ("fact_set_id","fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_slug_uq" ON "policies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_uq" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_one_active_uq" ON "policy_versions" USING btree ("policy_id") WHERE "policy_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "position_assignments_position_idx" ON "position_assignments" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_email_uq" ON "principals" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_oidc_uq" ON "principals" USING btree ("oidc_issuer","oidc_subject");--> statement-breakpoint
CREATE INDEX "requests_state_idx" ON "requests" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_uq" ON "role_assignments" USING btree ("principal_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "simulation_results_uq" ON "simulation_results" USING btree ("run_id","request_id");