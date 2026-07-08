/**
 * The decision rule over an approval task's actions:
 * any reject decides immediately (deny wins); otherwise approvals
 * accumulate until the quorum FROZEN AT TASK CREATION is met.
 */
export type TaskVerdict = "approved" | "rejected" | "pending";

export function decideTask(
  actions: ReadonlyArray<{ action: "approve" | "reject" }>,
  quorum: number
): TaskVerdict {
  if (actions.some((a) => a.action === "reject")) return "rejected";
  const approvals = actions.filter((a) => a.action === "approve").length;
  return approvals >= quorum ? "approved" : "pending";
}
