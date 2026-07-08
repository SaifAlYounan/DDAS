-- Immutability at the decision-critical layer, enforced by Postgres itself.
-- App code cannot opt out; a superuser rewriting history still breaks the
-- audit hash chain (verified against exported checkpoints).

-- Self-referencing FKs drizzle-kit does not emit from the TS schema:
ALTER TABLE "principals" ADD CONSTRAINT "principals_owner_fk"
  FOREIGN KEY ("owner_principal_id") REFERENCES "principals"("id");
--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "org_units"("id");
--> statement-breakpoint

CREATE FUNCTION ddas_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ddas: % on % is forbidden — this table is INSERT-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- INSERT-only tables: the audit chain and everything a decision rests on.
CREATE TRIGGER audit_events_insert_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER classifications_insert_only
  BEFORE UPDATE OR DELETE ON classifications
  FOR EACH ROW EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER classifications_no_truncate
  BEFORE TRUNCATE ON classifications
  FOR EACH STATEMENT EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER decisions_insert_only
  BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER decisions_no_truncate
  BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_actions_insert_only
  BEFORE UPDATE OR DELETE ON approval_actions
  FOR EACH ROW EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_actions_no_truncate
  BEFORE TRUNCATE ON approval_actions
  FOR EACH STATEMENT EXECUTE FUNCTION ddas_forbid_mutation();
--> statement-breakpoint

-- policy_versions freeze once they leave draft. The only legal post-draft
-- change is active → retired, touching status/retired_at and nothing else.
CREATE FUNCTION ddas_policy_version_freeze() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'retired'
     AND to_jsonb(OLD) - 'status' - 'retired_at' = to_jsonb(NEW) - 'status' - 'retired_at' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ddas: policy_versions row % is frozen (status %)', OLD.id, OLD.status;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER policy_versions_freeze
  BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION ddas_policy_version_freeze();
--> statement-breakpoint
CREATE FUNCTION ddas_policy_version_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'ddas: cannot delete non-draft policy_versions row %', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER policy_versions_no_delete
  BEFORE DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION ddas_policy_version_no_delete();
--> statement-breakpoint

-- fact_sets freeze once confirmed; corrections clone into version+1.
CREATE FUNCTION ddas_fact_set_freeze() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION 'ddas: cannot delete confirmed fact_set %', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'ddas: fact_set % is confirmed and frozen', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fact_sets_freeze
  BEFORE UPDATE OR DELETE ON fact_sets
  FOR EACH ROW EXECUTE FUNCTION ddas_fact_set_freeze();
--> statement-breakpoint

-- facts freeze with their parent fact_set.
CREATE FUNCTION ddas_fact_freeze() RETURNS trigger AS $$
DECLARE
  parent_status fact_set_status;
BEGIN
  SELECT status INTO parent_status FROM fact_sets WHERE id = OLD.fact_set_id;
  IF parent_status = 'confirmed' THEN
    RAISE EXCEPTION 'ddas: fact % belongs to a confirmed fact_set and is frozen', OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER facts_freeze
  BEFORE UPDATE OR DELETE ON facts
  FOR EACH ROW EXECUTE FUNCTION ddas_fact_freeze();
