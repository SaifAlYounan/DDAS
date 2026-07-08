import { z } from "zod";
import { appendAuditEvent } from "@ddas/audit";
import { decideTask } from "@ddas/routing";
import type { App, AppContext } from "../app.js";
import { transition } from "../domain/request-machine.js";
import { withTx } from "../domain/tx.js";
import { ApiError } from "../errors.js";

const TaskOut = z.object({
  id: z.string(),
  requestId: z.string(),
  requestTitle: z.string(),
  classificationId: z.string(),
  requiredTier: z.number(),
  quorum: z.number(),
  approvals: z.number(),
  dueAt: z.string(),
  escalationLevel: z.number(),
  status: z.enum(["open", "decided", "failed"]),
  routingFailed: z.boolean(),
  myAction: z.string().nullable(),
});

export function registerApprovalRoutes(app: App, ctx: AppContext): void {
  app.get(
    "/approvals/inbox",
    {
      schema: { tags: ["approvals"], response: { 200: z.array(TaskOut) } },
      preHandler: [app.requireRole("approver")],
    },
    async (request) => {
      const rows = await ctx.pool.query<{
        id: string;
        request_id: string;
        title: string;
        classification_id: string;
        required_tier: number;
        quorum: number;
        due_at: Date;
        escalation_level: number;
        status: "open" | "decided" | "failed";
        resolution_trace: { routingFailed?: boolean };
        approvals: string;
        my_action: string | null;
      }>(
        `SELECT t.*, r.title,
                (SELECT count(*) FROM approval_actions a
                  WHERE a.task_id = t.id AND a.action = 'approve') AS approvals,
                (SELECT a.action FROM approval_actions a
                  WHERE a.task_id = t.id AND a.principal_id = $1) AS my_action
         FROM approval_tasks t
         JOIN requests r ON r.id = t.request_id
         JOIN approval_task_approvers ap ON ap.task_id = t.id AND ap.principal_id = $1
         WHERE t.status = 'open'
         ORDER BY t.due_at ASC`,
        [request.principal!.id]
      );
      return rows.rows.map((t) => ({
        id: t.id,
        requestId: t.request_id,
        requestTitle: t.title,
        classificationId: t.classification_id,
        requiredTier: t.required_tier,
        quorum: t.quorum,
        approvals: Number(t.approvals),
        dueAt: t.due_at.toISOString(),
        escalationLevel: t.escalation_level,
        status: t.status,
        routingFailed: Boolean(t.resolution_trace?.routingFailed),
        myAction: t.my_action,
      }));
    }
  );

  app.get(
    "/approval-tasks/:id",
    {
      schema: {
        tags: ["approvals"],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            id: z.string(),
            requestId: z.string(),
            classificationId: z.string(),
            requiredTier: z.number(),
            quorum: z.number(),
            dueAt: z.string(),
            escalationLevel: z.number(),
            status: z.enum(["open", "decided", "failed"]),
            resolutionTrace: z.unknown(),
            approvers: z.array(
              z.object({
                principalId: z.string(),
                name: z.string(),
                via: z.enum(["position", "delegation", "escalation"]),
              })
            ),
            actions: z.array(
              z.object({
                principalId: z.string(),
                name: z.string(),
                action: z.enum(["approve", "reject"]),
                comment: z.string().nullable(),
                createdAt: z.string(),
              })
            ),
          }),
        },
      },
      preHandler: [app.requireRole("approver", "auditor")],
    },
    async (request) => {
      const tasks = await ctx.pool.query<{
        id: string;
        request_id: string;
        classification_id: string;
        required_tier: number;
        quorum: number;
        due_at: Date;
        escalation_level: number;
        status: "open" | "decided" | "failed";
        resolution_trace: unknown;
      }>("SELECT * FROM approval_tasks WHERE id = $1", [request.params.id]);
      const task = tasks.rows[0];
      if (!task) throw new ApiError("not_found", "approval task not found");

      const approvers = await ctx.pool.query<{
        principal_id: string;
        name: string;
        via: "position" | "delegation" | "escalation";
      }>(
        `SELECT ap.principal_id, p.name, ap.via
         FROM approval_task_approvers ap JOIN principals p ON p.id = ap.principal_id
         WHERE ap.task_id = $1 ORDER BY p.name`,
        [task.id]
      );
      const actions = await ctx.pool.query<{
        principal_id: string;
        name: string;
        action: "approve" | "reject";
        comment: string | null;
        created_at: Date;
      }>(
        `SELECT a.principal_id, p.name, a.action, a.comment, a.created_at
         FROM approval_actions a JOIN principals p ON p.id = a.principal_id
         WHERE a.task_id = $1 ORDER BY a.created_at`,
        [task.id]
      );

      return {
        id: task.id,
        requestId: task.request_id,
        classificationId: task.classification_id,
        requiredTier: task.required_tier,
        quorum: task.quorum,
        dueAt: task.due_at.toISOString(),
        escalationLevel: task.escalation_level,
        status: task.status,
        resolutionTrace: task.resolution_trace,
        approvers: approvers.rows.map((a) => ({
          principalId: a.principal_id,
          name: a.name,
          via: a.via,
        })),
        actions: actions.rows.map((a) => ({
          principalId: a.principal_id,
          name: a.name,
          action: a.action,
          comment: a.comment,
          createdAt: a.created_at.toISOString(),
        })),
      };
    }
  );

  async function act(
    taskId: string,
    principalId: string,
    action: "approve" | "reject",
    comment: string | null
  ) {
    const actor = { kind: "principal" as const, id: principalId };
    return withTx(ctx.pool, async (client) => {
      const tasks = await client.query<{
        id: string;
        request_id: string;
        quorum: number;
        status: string;
      }>("SELECT id, request_id, quorum, status FROM approval_tasks WHERE id = $1 FOR UPDATE", [
        taskId,
      ]);
      const task = tasks.rows[0];
      if (!task) throw new ApiError("not_found", "approval task not found");
      if (task.status !== "open") {
        throw new ApiError("state_conflict", `task is ${task.status}`);
      }
      // Eligibility = membership in the snapshot taken at resolution time.
      const eligible = await client.query(
        "SELECT 1 FROM approval_task_approvers WHERE task_id = $1 AND principal_id = $2",
        [taskId, principalId]
      );
      if (!eligible.rows[0]) {
        throw new ApiError("forbidden", "you are not in this task's approver snapshot");
      }

      await client.query(
        `INSERT INTO approval_actions (task_id, principal_id, action, comment)
         VALUES ($1, $2, $3, $4)`,
        [taskId, principalId, action, comment]
      ).catch((err: unknown) => {
        if (String(err).includes("approval_actions_uq")) {
          throw new ApiError("conflict", "you have already acted on this task");
        }
        throw err;
      });
      await appendAuditEvent(client, {
        actor,
        type: action === "approve" ? "approval.approved" : "approval.rejected",
        entity: { type: "approval_task", id: taskId },
        payload: { requestId: task.request_id, comment },
      });

      const actions = await client.query<{ action: "approve" | "reject" }>(
        "SELECT action FROM approval_actions WHERE task_id = $1",
        [taskId]
      );
      const verdict = decideTask(actions.rows, task.quorum);
      if (verdict === "pending") {
        return { verdict, approvals: actions.rows.filter((a) => a.action === "approve").length, quorum: task.quorum };
      }

      await client.query("UPDATE approval_tasks SET status = 'decided' WHERE id = $1", [taskId]);
      const decision = await client.query<{ id: string }>(
        `INSERT INTO decisions (request_id, task_id, outcome, decided_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [task.request_id, taskId, verdict === "approved" ? "approved" : "rejected", principalId]
      );
      await transition(client, task.request_id, "decided", actor, { outcome: verdict });
      await appendAuditEvent(client, {
        actor,
        type: "decision.recorded",
        entity: { type: "decision", id: decision.rows[0]!.id },
        payload: { requestId: task.request_id, taskId, outcome: verdict },
      });
      return { verdict, approvals: actions.rows.filter((a) => a.action === "approve").length, quorum: task.quorum };
    });
  }

  const ActOut = z.object({
    verdict: z.enum(["approved", "rejected", "pending"]),
    approvals: z.number(),
    quorum: z.number(),
  });

  app.post(
    "/approval-tasks/:id/approve",
    {
      schema: {
        tags: ["approvals"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ comment: z.string().optional() }).default({}),
        response: { 200: ActOut },
      },
      preHandler: [app.requireRole("approver")],
    },
    async (request) =>
      act(request.params.id, request.principal!.id, "approve", request.body.comment ?? null)
  );

  app.post(
    "/approval-tasks/:id/reject",
    {
      schema: {
        tags: ["approvals"],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ comment: z.string().min(1, "a rejection requires a comment") }),
        response: { 200: ActOut },
      },
      preHandler: [app.requireRole("approver")],
    },
    async (request) =>
      act(request.params.id, request.principal!.id, "reject", request.body.comment)
  );
}
