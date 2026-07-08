import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requestQuery } from "../api/queries";
import type { ConfirmResult, RequestDetail } from "../api/types";
import { ErrorNote, Loading } from "../components/Loading";
import { hasRole, useMe } from "../components/MeContext";
import { Badge, stateTone } from "../components/ui/Badge";
import { Tabs, type TabDef } from "../components/ui/Tabs";
import { DecisionTab } from "../features/DecisionTab";
import { DerivationView } from "../features/DerivationView";
import { FactsTab } from "../features/FactsTab";
import { cx, formatDate } from "../lib/format";

const STEPS = [
  "extracting",
  "facts_review",
  "classified",
  "pending_approval",
  "decided",
] as const;

function Stepper({ state }: { state: string }) {
  const idx = STEPS.indexOf(state as (typeof STEPS)[number]);
  if (idx === -1) return null;
  return (
    <ol className="flex items-center gap-0 overflow-x-auto">
      {STEPS.map((step, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={step} className="flex items-center">
            {i > 0 && (
              <span className={cx("mx-1 h-px w-8", done || current ? "bg-indigo-400" : "bg-gray-200")} />
            )}
            <span className="flex items-center gap-1.5">
              <span
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  done && "bg-indigo-600 text-white",
                  current && "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500",
                  !done && !current && "bg-gray-100 text-gray-400"
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={cx(
                  "text-xs whitespace-nowrap",
                  current ? "font-semibold text-indigo-700" : done ? "text-gray-600" : "text-gray-400"
                )}
              >
                {step.replace(/_/g, " ")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function defaultTab(request: RequestDetail): string {
  switch (request.state) {
    case "classified":
    case "pending_approval":
      return "classification";
    case "decided":
      return "decision";
    default:
      return "facts";
  }
}

export function RequestDetailPage({
  id,
  search,
}: {
  id: string;
  search: { tab?: string; task?: string };
}) {
  const navigate = useNavigate();
  const me = useMe();
  const canEditFacts = hasRole(me, "requester", "approver");
  const canReplay = hasRole(me, "auditor", "approver", "policy_author");
  const request = useQuery({
    ...requestQuery(id),
    refetchInterval: (query) =>
      query.state.data?.state === "extracting" ? 1500 : false,
  });

  const [tab, setTab] = useState<string | null>(search.tab ?? null);
  const [taskId, setTaskId] = useState<string | undefined>(search.task);

  // If the request finishes extracting while we watch, keep the default tab fresh.
  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab]);

  if (request.isPending) return <Loading label="Loading request…" />;
  if (request.isError) return <ErrorNote error={request.error} />;
  const r = request.data;

  const latestClassification = [...r.classifications].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )[0];

  const tabs: TabDef[] = [
    { id: "facts", label: "Facts", disabled: r.factSets.length === 0 },
    {
      id: "classification",
      label: "Classification",
      disabled: r.classifications.length === 0,
    },
    { id: "decision", label: "Decision" },
  ];

  const activeTab = tab ?? defaultTab(r);

  const onClassified = (res: ConfirmResult) => {
    setTab("classification");
    if (res.routing.kind === "task_created" && res.routing.taskId) {
      setTaskId(res.routing.taskId);
      void navigate({
        to: "/requests/$id",
        params: { id },
        search: { tab: "classification", task: res.routing.taskId },
        replace: true,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">{r.title}</h1>
          <p className="mt-1 text-xs text-gray-500">
            Submitted {formatDate(r.createdAt)}
            {r.actionType ? ` · action type ${r.actionType}` : ""} · {r.documents.length}{" "}
            document(s)
          </p>
        </div>
        <Badge tone={stateTone(r.state)} className="text-sm">
          {r.state.replace(/_/g, " ")}
        </Badge>
      </div>

      {r.state === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Request failed{r.failureReason ? `: ${r.failureReason}` : "."}
        </div>
      )}
      {r.state === "cancelled" && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Request was cancelled.
        </div>
      )}

      <Stepper state={r.state} />

      {r.state === "extracting" ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-blue-800">
            Extracting facts from {r.documents.length} document(s)…
          </p>
          <p className="mt-1 text-xs text-blue-600">
            This page refreshes automatically every 1.5 s.
          </p>
        </div>
      ) : (
        <>
          <Tabs tabs={tabs} active={activeTab} onChange={setTab} />
          {activeTab === "facts" && (
            <FactsTab request={r} onClassified={onClassified} canEdit={canEditFacts} />
          )}
          {activeTab === "classification" &&
            (latestClassification ? (
              <DerivationView classificationId={latestClassification.id} showReplay={canReplay} />
            ) : (
              <p className="py-8 text-center text-sm text-gray-400">No classification yet.</p>
            ))}
          {activeTab === "decision" && <DecisionTab request={r} taskId={taskId} />}
        </>
      )}
    </div>
  );
}
