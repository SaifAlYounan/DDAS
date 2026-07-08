/**
 * The request state machine — ONE transition table. No route writes
 * `requests.state` directly; every change goes through transition(), which
 * locks the row, checks the table, mutates, and audits in the caller's tx.
 */
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import type pg from "pg";
import { ApiError } from "../errors.js";

export const REQUEST_STATES = [
  "extracting",
  "facts_review",
  "classified",
  "pending_approval",
  "decided",
  "cancelled",
  "failed",
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

/** from → the set of legal targets. Anything unlisted is a state_conflict. */
const TRANSITIONS: Record<RequestState, readonly RequestState[]> = {
  extracting: ["facts_review", "failed", "cancelled"],
  facts_review: ["classified", "cancelled"],
  classified: ["pending_approval", "decided", "facts_review"],
  pending_approval: ["decided", "cancelled"],
  decided: [],
  cancelled: [],
  failed: ["extracting", "cancelled"],
};

export function canTransition(from: RequestState, to: RequestState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Lock → check → mutate → audit, atomically in the caller's transaction.
 * Returns the previous state.
 */
export async function transition(
  client: pg.ClientBase,
  requestId: string,
  to: RequestState,
  actor: AuditActor,
  payload: Record<string, unknown> = {}
): Promise<RequestState> {
  const row = await client.query<{ state: RequestState }>(
    "SELECT state FROM requests WHERE id = $1 FOR UPDATE",
    [requestId]
  );
  if (!row.rows[0]) throw new ApiError("not_found", `request ${requestId} not found`);
  const from = row.rows[0].state;
  if (!canTransition(from, to)) {
    throw new ApiError(
      "state_conflict",
      `request ${requestId} cannot go ${from} → ${to}`,
      { from, to }
    );
  }
  await client.query("UPDATE requests SET state = $1, updated_at = now() WHERE id = $2", [
    to,
    requestId,
  ]);
  await appendAuditEvent(client, {
    actor,
    type: "request.state_changed",
    entity: { type: "request", id: requestId },
    payload: { from, to, ...payload },
  });
  return from;
}
