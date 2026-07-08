/**
 * The audit hash chain. Every event's hash covers its full envelope INCLUDING
 * the previous event's hash — rewriting any row breaks every hash after it.
 * A superuser can still rewrite the whole chain; exported checkpoints stored
 * OUTSIDE the deployment are the defense (verify against a checkpoint you kept).
 *
 * appendAuditEvent runs inside the CALLER's transaction so a business mutation
 * and its audit event commit atomically. An advisory xact lock serializes
 * writers; the lock releases with the transaction.
 */
import { createHash } from "node:crypto";
import { canonicalize, type JsonValue } from "@ddas/policy";
import type pg from "pg";
import type { NewAuditEvent } from "./events.js";

export const GENESIS_HASH = "GENESIS";

/** Fixed advisory-lock key for the chain (arbitrary constant, project-unique). */
const CHAIN_LOCK_KEY = 0x0dda5;

interface Envelope {
  seq: number;
  occurredAt: string;
  actor: JsonValue;
  type: string;
  entity: JsonValue;
  payload: JsonValue;
  prevHash: string;
}

export function hashEnvelope(envelope: Envelope): string {
  return createHash("sha256")
    .update(canonicalize(envelope as unknown as JsonValue))
    .digest("hex");
}

export interface AppendedEvent {
  seq: number;
  eventHash: string;
  occurredAt: string;
}

/**
 * Append one event to the chain. `client` MUST be inside a transaction —
 * the advisory lock is transaction-scoped and the row must commit or roll
 * back together with the business mutation it records.
 */
export async function appendAuditEvent(
  client: pg.ClientBase,
  event: NewAuditEvent,
  now: Date = new Date()
): Promise<AppendedEvent> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK_KEY]);

  const head = await client.query<{ seq: string; event_hash: string }>(
    "SELECT seq, event_hash FROM audit_events ORDER BY seq DESC LIMIT 1"
  );
  const prevSeq = head.rows[0] ? Number(head.rows[0].seq) : 0;
  const prevHash = head.rows[0]?.event_hash ?? GENESIS_HASH;

  const envelope: Envelope = {
    seq: prevSeq + 1,
    occurredAt: now.toISOString(),
    actor: event.actor as unknown as JsonValue,
    type: event.type,
    entity: event.entity as unknown as JsonValue,
    payload: event.payload as unknown as JsonValue,
    prevHash,
  };
  const eventHash = hashEnvelope(envelope);

  await client.query(
    `INSERT INTO audit_events (seq, occurred_at, actor, type, entity, payload, prev_hash, event_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      envelope.seq,
      envelope.occurredAt,
      JSON.stringify(envelope.actor),
      envelope.type,
      JSON.stringify(envelope.entity),
      JSON.stringify(envelope.payload),
      envelope.prevHash,
      eventHash,
    ]
  );

  return { seq: envelope.seq, eventHash, occurredAt: envelope.occurredAt };
}

export type VerifyResult =
  | { ok: true; head: { seq: number; eventHash: string } | null; checked: number }
  | { ok: false; firstBadSeq: number; reason: string };

/**
 * Re-walk the whole chain in seq order (streamed in batches) and recompute
 * every hash. This IS the tamper-detection procedure — any rewritten,
 * deleted, or inserted row surfaces as the first bad seq.
 */
export async function verifyChain(
  client: pg.ClientBase,
  opts: { batchSize?: number } = {}
): Promise<VerifyResult> {
  const batchSize = opts.batchSize ?? 1000;
  let expectedSeq = 1;
  let prevHash = GENESIS_HASH;
  let head: { seq: number; eventHash: string } | null = null;

  for (;;) {
    const batch = await client.query<{
      seq: string;
      occurred_at: Date;
      actor: JsonValue;
      type: string;
      entity: JsonValue;
      payload: JsonValue;
      prev_hash: string;
      event_hash: string;
    }>(
      `SELECT seq, occurred_at, actor, type, entity, payload, prev_hash, event_hash
       FROM audit_events WHERE seq >= $1 ORDER BY seq ASC LIMIT $2`,
      [expectedSeq, batchSize]
    );
    if (batch.rows.length === 0) break;

    for (const row of batch.rows) {
      const seq = Number(row.seq);
      if (seq !== expectedSeq) {
        return { ok: false, firstBadSeq: expectedSeq, reason: `gap: expected seq ${expectedSeq}, found ${seq}` };
      }
      if (row.prev_hash !== prevHash) {
        return { ok: false, firstBadSeq: seq, reason: "prev_hash does not match the previous event's hash" };
      }
      const recomputed = hashEnvelope({
        seq,
        occurredAt: row.occurred_at.toISOString(),
        actor: row.actor,
        type: row.type,
        entity: row.entity,
        payload: row.payload,
        prevHash: row.prev_hash,
      });
      if (recomputed !== row.event_hash) {
        return { ok: false, firstBadSeq: seq, reason: "event_hash does not match the recomputed envelope hash" };
      }
      prevHash = row.event_hash;
      head = { seq, eventHash: row.event_hash };
      expectedSeq = seq + 1;
    }
  }

  return { ok: true, head, checked: expectedSeq - 1 };
}

export interface Checkpoint {
  seq: number;
  eventHash: string;
  exportedAt: string;
}

/**
 * Export the chain head as a small JSON to store OUTSIDE the deployment.
 * Later verifies compare the stored head hash at that seq — a superuser who
 * rewrote history cannot reproduce it.
 */
export async function exportCheckpoint(
  client: pg.ClientBase,
  now: Date = new Date()
): Promise<Checkpoint | null> {
  const head = await client.query<{ seq: string; event_hash: string }>(
    "SELECT seq, event_hash FROM audit_events ORDER BY seq DESC LIMIT 1"
  );
  const row = head.rows[0];
  if (!row) return null;
  return { seq: Number(row.seq), eventHash: row.event_hash, exportedAt: now.toISOString() };
}

/** Verify a previously exported checkpoint against the current chain. */
export async function verifyCheckpoint(
  client: pg.ClientBase,
  checkpoint: Checkpoint
): Promise<{ ok: boolean; reason?: string }> {
  const row = await client.query<{ event_hash: string }>(
    "SELECT event_hash FROM audit_events WHERE seq = $1",
    [checkpoint.seq]
  );
  if (!row.rows[0]) {
    return { ok: false, reason: `no event at seq ${checkpoint.seq} — chain truncated?` };
  }
  if (row.rows[0].event_hash !== checkpoint.eventHash) {
    return { ok: false, reason: `hash mismatch at seq ${checkpoint.seq} — history rewritten` };
  }
  return { ok: true };
}
