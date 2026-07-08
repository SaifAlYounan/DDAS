import { useQuery } from "@tanstack/react-query";
import { approvalTaskQuery } from "../api/queries";
import type { RequestDetail, ResolutionTrace } from "../api/types";
import { ErrorNote, Loading } from "../components/Loading";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Table, Td } from "../components/ui/Table";
import { formatDate } from "../lib/format";

function outcomeTone(outcome: string): BadgeTone {
  if (outcome.includes("approv")) return "green";
  if (outcome.includes("reject")) return "red";
  return "gray";
}

export function DecisionTab({
  request,
  taskId,
}: {
  request: RequestDetail;
  taskId: string | undefined;
}) {
  return (
    <div className="space-y-6">
      <Card title="Decision">
        {request.decision ? (
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">Outcome</dt>
              <dd className="mt-1">
                <Badge tone={outcomeTone(request.decision.outcome)}>
                  {request.decision.outcome.replace(/_/g, " ")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Decided by</dt>
              <dd className="mt-1 text-sm text-gray-800">
                {request.decision.decidedBy ?? "system"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Decided at</dt>
              <dd className="mt-1 text-sm text-gray-800">
                {formatDate(request.decision.decidedAt)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">
            No decision yet
            {request.state === "pending_approval" ? " — the request is awaiting approval." : "."}
          </p>
        )}
      </Card>

      {taskId ? (
        <ApprovalTaskView taskId={taskId} />
      ) : (
        <p className="text-xs text-gray-400">
          No approval task is linked in this view. Open the request from the approver inbox (or
          re-classify) to attach the task and its routing trace.
        </p>
      )}
    </div>
  );
}

function ApprovalTaskView({ taskId }: { taskId: string }) {
  const task = useQuery(approvalTaskQuery(taskId));
  if (task.isPending) return <Loading label="Loading approval task…" />;
  if (task.isError) return <ErrorNote error={task.error} />;
  const t = task.data;

  return (
    <div className="space-y-6">
      <Card
        title="Approval task"
        actions={
          <Badge tone={t.status === "open" ? "amber" : t.status === "decided" ? "green" : "red"}>
            {t.status}
          </Badge>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Required tier</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">Tier {t.requiredTier}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Quorum</dt>
            <dd className="mt-1 text-sm text-gray-800">{t.quorum} approval(s)</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Due</dt>
            <dd className="mt-1 text-sm text-gray-800">{formatDate(t.dueAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Escalation level</dt>
            <dd className="mt-1 text-sm text-gray-800">{t.escalationLevel}</dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
              Eligible approvers
            </p>
            <ul className="space-y-1">
              {t.approvers.map((a) => (
                <li key={a.principalId} className="flex items-center gap-2 text-sm text-gray-800">
                  {a.name}
                  <Badge
                    tone={
                      a.via === "position" ? "indigo" : a.via === "delegation" ? "blue" : "amber"
                    }
                  >
                    via {a.via}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
              Actions taken
            </p>
            {t.actions.length === 0 ? (
              <p className="text-sm text-gray-400">None yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {t.actions.map((a, i) => (
                  <li key={i} className="text-sm text-gray-800">
                    <Badge tone={a.action === "approve" ? "green" : "red"}>{a.action}</Badge>{" "}
                    {a.name} · {formatDate(a.createdAt)}
                    {a.comment && (
                      <span className="block text-xs text-gray-500 italic">“{a.comment}”</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {t.resolutionTrace && <RoutingTraceView trace={t.resolutionTrace} />}
    </div>
  );
}

export function RoutingTraceView({ trace }: { trace: ResolutionTrace }) {
  return (
    <Card
      title="Routing trace"
      actions={
        <Badge tone={trace.outcome === "resolved" ? "green" : "red"}>
          {trace.outcome.replace(/_/g, " ")}
        </Badge>
      }
    >
      <p className="mb-4 text-xs text-gray-500">
        Resolved as of {formatDate(trace.asOf)} · required tier {trace.requiredTier} · quorum rule{" "}
        <span className="font-mono">{String(trace.quorumRule)}</span> → quorum {trace.quorum}
        {trace.requesterExcluded && " · requester excluded from approving"}
      </p>

      <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Ladder steps (widening up the org tree)
      </p>
      <ol className="mb-5 space-y-2">
        {trace.ladder.map((step, i) => (
          <li key={i} className="rounded-md border border-gray-200 px-3 py-2">
            <p className="text-xs font-medium text-gray-700">
              Step {i + 1} — unit <span className="font-mono">{step.unitId}</span>
            </p>
            {step.eligible.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {step.eligible.map((e) => (
                  <li key={e.assignmentId} className="text-xs text-gray-600">
                    <span className="font-mono">{e.principalId}</span> — tier {e.tier}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-gray-400">No eligible holders at this step.</p>
            )}
            {step.vacantPositions.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Vacant positions: {step.vacantPositions.join(", ")}
              </p>
            )}
          </li>
        ))}
        {trace.ladder.length === 0 && (
          <li className="text-xs text-gray-400">No ladder steps were evaluated.</li>
        )}
      </ol>

      <p className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Delegations considered
      </p>
      {trace.delegations.length === 0 ? (
        <p className="text-sm text-gray-400">None considered.</p>
      ) : (
        <Table head={["Delegation", "From", "To", "Outcome", "Reason"]}>
          {trace.delegations.map((d) => (
            <tr key={d.delegationId}>
              <Td className="font-mono text-xs">{d.delegationId.slice(0, 8)}…</Td>
              <Td className="font-mono text-xs">{d.from.slice(0, 8)}…</Td>
              <Td className="font-mono text-xs">{d.to.slice(0, 8)}…</Td>
              <Td>
                <Badge tone={d.admitted ? "green" : "red"}>
                  {d.admitted ? "admitted" : "rejected"}
                </Badge>
              </Td>
              <Td className="text-xs">{d.reason}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
