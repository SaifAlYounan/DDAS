import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { inboxQuery } from "../api/queries";
import type { ApprovalVerdict, InboxItem } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Textarea } from "../components/ui/Textarea";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { DerivationView } from "../features/DerivationView";
import { cx, formatCountdown } from "../lib/format";

export function InboxPage() {
  const inbox = useQuery(inboxQuery);
  const [selected, setSelected] = useState<InboxItem | null>(null);

  // Re-render every 30s so due-at countdowns stay honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">Approver inbox</h1>

      {inbox.isPending && <Loading />}
      {inbox.isError && <ErrorNote error={inbox.error} />}
      {inbox.isSuccess && (
        <Table head={["Request", "Tier", "Due", "Quorum", ""]}>
          {inbox.data.length === 0 && (
            <EmptyRow colSpan={5} message="Nothing waiting on you." />
          )}
          {inbox.data.map((item) => {
            const due = formatCountdown(item.dueAt);
            return (
              <tr
                key={item.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setSelected(item)}
              >
                <Td>
                  <span className="font-medium text-gray-900">{item.requestTitle}</span>
                  <span className="ml-2 inline-flex gap-1.5 align-middle">
                    {item.escalationLevel > 0 && (
                      <Badge tone="red">escalated ×{item.escalationLevel}</Badge>
                    )}
                    {item.routingFailed && <Badge tone="red">routing failed</Badge>}
                    {item.myAction !== null && <Badge tone="gray">you: {item.myAction}</Badge>}
                  </span>
                </Td>
                <Td>
                  <Badge tone="indigo">Tier {item.requiredTier}</Badge>
                </Td>
                <Td>
                  <span className={cx("text-sm", due.overdue ? "font-semibold text-red-600" : "text-gray-600")}>
                    {due.label}
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {item.approvals}/{item.quorum}
                    </span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                      <span
                        className="block h-full rounded-full bg-indigo-500"
                        style={{
                          width: `${Math.min(100, (item.approvals / Math.max(1, item.quorum)) * 100)}%`,
                        }}
                      />
                    </span>
                  </span>
                </Td>
                <Td className="text-right">
                  <span className="text-xs font-medium text-indigo-600">Review →</span>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {selected && <DecisionModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DecisionModal({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");

  const decide = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      api.post<ApprovalVerdict>(
        `/approval-tasks/${item.id}/${action}`,
        action === "reject" || comment.trim().length > 0
          ? { comment: comment.trim() }
          : {}
      ),
    onSuccess: (res, action) => {
      toast.push(
        res.verdict === "pending"
          ? `Recorded your ${action} — ${res.approvals}/${res.quorum} approvals so far`
          : `Request ${res.verdict}`,
        res.verdict === "rejected" ? "info" : "success"
      );
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["requests"] });
      onClose();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const alreadyActed = item.myAction !== null || item.status !== "open";

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Decide: ${item.requestTitle}`}
      wide
      footer={
        <>
          <Link
            to="/requests/$id"
            params={{ id: item.requestId }}
            search={{ tab: "decision", task: item.id }}
            className="mr-auto text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            Open full request →
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="danger"
            disabled={alreadyActed || decide.isPending || comment.trim().length === 0}
            onClick={() => decide.mutate("reject")}
            title={comment.trim().length === 0 ? "A comment is required to reject" : undefined}
          >
            Reject
          </Button>
          <Button
            disabled={alreadyActed || decide.isPending}
            onClick={() => decide.mutate("approve")}
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <DerivationView classificationId={item.classificationId} />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Comment{" "}
            <span className="font-normal text-gray-400">
              (optional for approve, required for reject)
            </span>
          </label>
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why you approve or reject — goes into the audit trail."
          />
        </div>
        {alreadyActed && (
          <p className="text-xs text-amber-700">
            {item.status !== "open"
              ? "This task is no longer open."
              : `You already acted on this task (${item.myAction ?? ""}).`}
          </p>
        )}
      </div>
    </Dialog>
  );
}
