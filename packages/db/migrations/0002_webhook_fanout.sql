-- Webhook fanout: delivery rows are created by Postgres itself, in the SAME
-- transaction as the audit event they announce — a business mutation and its
-- outbound notifications commit or roll back together. Sending happens after
-- commit, from the delivery worker.
CREATE FUNCTION ddas_webhook_fanout() RETURNS trigger AS $$
BEGIN
  INSERT INTO webhook_deliveries (webhook_id, event_seq, status, next_attempt_at)
  SELECT w.id, NEW.seq, 'pending', now()
  FROM webhooks w
  WHERE w.active AND NEW.type = ANY(w.events);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_webhook_fanout
  AFTER INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION ddas_webhook_fanout();
