import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appendAuditEvent, AUDIT_EVENT_TYPES } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

export function registerWebhookRoutes(app: App, ctx: AppContext): void {
  app.post(
    "/admin/webhooks",
    {
      schema: {
        tags: ["webhooks"],
        body: z.object({
          url: z.string().url(),
          events: z.array(z.string()).min(1),
          /** Omitted → generated and returned once. */
          secret: z.string().min(16).optional(),
        }),
        response: {
          200: z.object({ id: z.string(), secret: z.string() }),
        },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const { url, events } = request.body;
      const known = new Set<string>(AUDIT_EVENT_TYPES);
      const unknown = events.filter((event) => !known.has(event));
      if (unknown.length > 0) {
        throw new ApiError("validation_failed", `unknown event types: ${unknown.join(", ")}`, {
          knownEvents: AUDIT_EVENT_TYPES,
        });
      }
      const secret = request.body.secret ?? randomBytes(24).toString("hex");
      const actor = { kind: "principal" as const, id: request.principal!.id };
      return withTx(ctx.pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO webhooks (url, secret, events, active) VALUES ($1, $2, $3, TRUE) RETURNING id",
          [url, secret, events]
        );
        await appendAuditEvent(client, {
          actor,
          type: "webhook.created",
          entity: { type: "webhook", id: inserted.rows[0]!.id },
          payload: { url, events },
        });
        return { id: inserted.rows[0]!.id, secret };
      });
    }
  );

  app.get(
    "/admin/webhooks",
    {
      schema: {
        tags: ["webhooks"],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              url: z.string(),
              events: z.array(z.string()),
              active: z.boolean(),
              createdAt: z.string(),
            })
          ),
        },
      },
      preHandler: [app.requireRole("admin")],
    },
    async () => {
      const rows = await ctx.pool.query<{
        id: string;
        url: string;
        events: string[];
        active: boolean;
        created_at: Date;
      }>("SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at DESC");
      return rows.rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        createdAt: w.created_at.toISOString(),
      }));
    }
  );

  app.delete(
    "/admin/webhooks/:id",
    {
      schema: {
        tags: ["webhooks"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      await withTx(ctx.pool, async (client) => {
        const updated = await client.query(
          "UPDATE webhooks SET active = FALSE WHERE id = $1 AND active",
          [request.params.id]
        );
        if (updated.rowCount === 0) {
          throw new ApiError("not_found", "webhook not found or already deactivated");
        }
        await appendAuditEvent(client, {
          actor,
          type: "webhook.deleted",
          entity: { type: "webhook", id: request.params.id },
          payload: {},
        });
      });
      return { ok: true };
    }
  );

  app.get(
    "/admin/webhooks/:id/deliveries",
    {
      schema: {
        tags: ["webhooks"],
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(200).default(50),
        }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              eventSeq: z.number(),
              eventType: z.string(),
              status: z.enum(["pending", "delivered", "dead"]),
              attempts: z.number(),
              lastError: z.string().nullable(),
              nextAttemptAt: z.string().nullable(),
              deliveredAt: z.string().nullable(),
              createdAt: z.string(),
            })
          ),
        },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const rows = await ctx.pool.query<{
        id: string;
        event_seq: string;
        type: string;
        status: "pending" | "delivered" | "dead";
        attempts: number;
        last_error: string | null;
        next_attempt_at: Date | null;
        delivered_at: Date | null;
        created_at: Date;
      }>(
        `SELECT d.id, d.event_seq, e.type, d.status, d.attempts, d.last_error,
                d.next_attempt_at, d.delivered_at, d.created_at
         FROM webhook_deliveries d JOIN audit_events e ON e.seq = d.event_seq
         WHERE d.webhook_id = $1 ORDER BY d.created_at DESC LIMIT $2`,
        [request.params.id, request.query.limit]
      );
      return rows.rows.map((d) => ({
        id: d.id,
        eventSeq: Number(d.event_seq),
        eventType: d.type,
        status: d.status,
        attempts: d.attempts,
        lastError: d.last_error,
        nextAttemptAt: d.next_attempt_at?.toISOString() ?? null,
        deliveredAt: d.delivered_at?.toISOString() ?? null,
        createdAt: d.created_at.toISOString(),
      }));
    }
  );

  app.post(
    "/admin/webhook-deliveries/:id/redeliver",
    {
      schema: {
        tags: ["webhooks"],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
      preHandler: [app.requireRole("admin")],
    },
    async (request) => {
      const updated = await ctx.pool.query(
        `UPDATE webhook_deliveries
         SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = now()
         WHERE id = $1 AND status IN ('dead', 'delivered')`,
        [request.params.id]
      );
      if (updated.rowCount === 0) {
        throw new ApiError("not_found", "delivery not found or still pending");
      }
      return { ok: true };
    }
  );
}
