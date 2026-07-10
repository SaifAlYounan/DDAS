import { z } from "zod";
import { appendAuditEvent, exportCheckpoint, verifyChain } from "@ddas/audit";
import type { App, AppContext } from "../app.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

export function registerAuditRoutes(app: App, ctx: AppContext): void {
  app.get(
    "/audit/events",
    {
      schema: {
        tags: ["audit"],
        querystring: z.object({
          after: z.coerce.number().int().nonnegative().default(0),
          limit: z.coerce.number().int().positive().max(500).default(100),
          type: z.string().optional(),
        }),
        response: {
          200: z.array(
            z.object({
              seq: z.number(),
              occurredAt: z.string(),
              actor: z.unknown(),
              type: z.string(),
              entity: z.unknown(),
              payload: z.unknown(),
              eventHash: z.string(),
            })
          ),
        },
      },
      preHandler: [app.requirePermission("audit.read")],
    },
    async (request) => {
      const params: unknown[] = [request.query.after, request.query.limit];
      let typeFilter = "";
      if (request.query.type) {
        params.push(request.query.type);
        typeFilter = "AND type = $3";
      }
      const rows = await ctx.pool.query<{
        seq: string;
        occurred_at: Date;
        actor: unknown;
        type: string;
        entity: unknown;
        payload: unknown;
        event_hash: string;
      }>(
        `SELECT seq, occurred_at, actor, type, entity, payload, event_hash
         FROM audit_events WHERE seq > $1 ${typeFilter} ORDER BY seq ASC LIMIT $2`,
        params
      );
      return rows.rows.map((r) => ({
        seq: Number(r.seq),
        occurredAt: r.occurred_at.toISOString(),
        actor: r.actor,
        type: r.type,
        entity: r.entity,
        payload: r.payload,
        eventHash: r.event_hash,
      }));
    }
  );

  app.post(
    "/audit/verify",
    {
      schema: {
        tags: ["audit"],
        response: {
          200: z.union([
            z.object({
              ok: z.literal(true),
              checked: z.number(),
              head: z.object({ seq: z.number(), eventHash: z.string() }).nullable(),
            }),
            z.object({
              ok: z.literal(false),
              firstBadSeq: z.number(),
              reason: z.string(),
            }),
          ]),
        },
      },
      preHandler: [app.requirePermission("audit.verify")],
    },
    async () => {
      const client = await ctx.pool.connect();
      try {
        return await verifyChain(client);
      } finally {
        client.release();
      }
    }
  );

  app.get(
    "/audit/checkpoint",
    {
      schema: {
        tags: ["audit"],
        response: {
          200: z.object({
            seq: z.number(),
            eventHash: z.string(),
            exportedAt: z.string(),
          }),
        },
      },
      preHandler: [app.requirePermission("audit.read")],
    },
    async (request, reply) => {
      const actor = { kind: "principal" as const, id: request.principal!.id };
      const checkpoint = await withTx(ctx.pool, async (client) => {
        const cp = await exportCheckpoint(client);
        if (cp) {
          await appendAuditEvent(client, {
            actor,
            type: "audit.checkpoint_exported",
            entity: { type: "audit_chain", id: "head" },
            payload: { seq: cp.seq, eventHash: cp.eventHash },
          });
        }
        return cp;
      });
      if (!checkpoint) {
        throw new ApiError("not_found", "audit chain is empty");
      }
      reply.header(
        "content-disposition",
        `attachment; filename="ddas-audit-checkpoint-${checkpoint.seq}.json"`
      );
      return checkpoint;
    }
  );
}
