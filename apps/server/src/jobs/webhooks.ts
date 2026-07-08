/**
 * Webhook delivery worker. Rows are created by the Postgres fanout trigger
 * atomically with their audit event; this worker only SENDS. Claims are
 * FOR UPDATE SKIP LOCKED so multiple server replicas never double-send.
 * Retry (up to WEBHOOK_DEFAULTS.maxAttempts, currently 8) with exponential
 * backoff → dead + audit event.
 *
 * Signature: X-DDAS-Signature: t=<unix-seconds>,v1=hmac_sha256(secret, t + "." + body)
 * Receivers must reject |now - t| > 300s (replay window) and can use
 * X-DDAS-Delivery for idempotency.
 */
import { createHmac } from "node:crypto";
import { appendAuditEvent } from "@ddas/audit";
import type pg from "pg";
import type { AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";

export interface WebhookWorkerOptions {
  pollMs: number;
  retryBaseMs: number;
  maxAttempts: number;
  timeoutMs: number;
}

export const WEBHOOK_DEFAULTS: WebhookWorkerOptions = {
  pollMs: 2000,
  retryBaseMs: 30_000,
  maxAttempts: 8,
  timeoutMs: 10_000,
};

export function signWebhookBody(secret: string, body: string, unixSeconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
  return `t=${unixSeconds},v1=${v1}`;
}

interface ClaimedDelivery {
  id: string;
  webhook_id: string;
  attempts: number;
  url: string;
  secret: string;
  seq: string;
  occurred_at: Date;
  type: string;
  actor: unknown;
  entity: unknown;
  payload: unknown;
  event_hash: string;
}

/** Deliver one claimed row. Returns the terminal status it reached. */
async function deliverOne(
  ctx: AppContext,
  client: pg.PoolClient,
  delivery: ClaimedDelivery,
  options: WebhookWorkerOptions
): Promise<"delivered" | "retrying" | "dead"> {
  const body = JSON.stringify({
    deliveryId: delivery.id,
    event: {
      seq: Number(delivery.seq),
      occurredAt: delivery.occurred_at.toISOString(),
      type: delivery.type,
      actor: delivery.actor,
      entity: delivery.entity,
      payload: delivery.payload,
      eventHash: delivery.event_hash,
    },
  });
  const signature = signWebhookBody(
    delivery.secret,
    body,
    Math.floor(Date.now() / 1000)
  );

  let failure: string | null = null;
  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ddas-signature": signature,
        "x-ddas-delivery": delivery.id,
        "x-ddas-event": delivery.type,
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) failure = `HTTP ${response.status}`;
  } catch (err) {
    failure = String(err);
  }

  if (!failure) {
    await client.query(
      "UPDATE webhook_deliveries SET status = 'delivered', delivered_at = now(), attempts = attempts + 1 WHERE id = $1",
      [delivery.id]
    );
    return "delivered";
  }

  const attempts = delivery.attempts + 1;
  if (attempts >= options.maxAttempts) {
    await client.query(
      "UPDATE webhook_deliveries SET status = 'dead', attempts = $2, last_error = $3 WHERE id = $1",
      [delivery.id, attempts, failure]
    );
    await appendAuditEvent(client, {
      actor: { kind: "system" },
      type: "webhook.delivery_dead",
      entity: { type: "webhook_delivery", id: delivery.id },
      payload: { webhookId: delivery.webhook_id, eventSeq: Number(delivery.seq), attempts, lastError: failure },
    });
    return "dead";
  }

  const backoffMs = options.retryBaseMs * 2 ** (attempts - 1);
  await client.query(
    `UPDATE webhook_deliveries
     SET attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' milliseconds')::interval
     WHERE id = $1`,
    [delivery.id, attempts, failure, String(backoffMs)]
  );
  return "retrying";
}

/** One sweep: claim + send every due pending delivery. Returns count handled. */
export async function sweepWebhookDeliveries(
  ctx: AppContext,
  options: WebhookWorkerOptions
): Promise<number> {
  let handled = 0;
  for (;;) {
    const processed = await withTx(ctx.pool, async (client) => {
      const claimed = await client.query<ClaimedDelivery>(
        `SELECT d.id, d.webhook_id, d.attempts, w.url, w.secret,
                e.seq, e.occurred_at, e.type, e.actor, e.entity, e.payload, e.event_hash
         FROM webhook_deliveries d
         JOIN webhooks w ON w.id = d.webhook_id
         JOIN audit_events e ON e.seq = d.event_seq
         WHERE d.status = 'pending' AND d.next_attempt_at <= now()
         ORDER BY d.next_attempt_at
         FOR UPDATE OF d SKIP LOCKED
         LIMIT 1`
      );
      const row = claimed.rows[0];
      if (!row) return false;
      const outcome = await deliverOne(ctx, client, row, options);
      ctx.counters.webhookDeliveries.inc({ outcome });
      return true;
    });
    if (!processed) return handled;
    handled += 1;
  }
}

export function startWebhookWorker(
  ctx: AppContext,
  options: WebhookWorkerOptions,
  onError: (err: unknown) => void
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // no overlapping sweeps
    running = true;
    sweepWebhookDeliveries(ctx, options)
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, options.pollMs);
  timer.unref();
  return () => clearInterval(timer);
}
