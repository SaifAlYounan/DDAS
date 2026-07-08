import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { simulationQuery } from "../api/queries";
import type { ReplayedOutcome, SimulationSummary } from "../api/types";
import { ErrorNote, Loading } from "../components/Loading";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { cx, formatDate, shortHash } from "../lib/format";
import { setLastSimulationId } from "../lib/lastSimulation";

function tierLabel(tier: number | null): string {
  return tier === null ? "INC" : String(tier);
}

function outcomeCell(o: ReplayedOutcome | undefined): React.ReactNode {
  if (!o) return <span className="text-gray-400">—</span>;
  if (o.status === "INCOMPLETE") return <Badge tone="amber">INCOMPLETE</Badge>;
  return (
    <span>
      <Badge tone="indigo">Tier {o.tier}</Badge>
      {o.tierName && <span className="ml-1.5 text-xs text-gray-500">{o.tierName}</span>}
    </span>
  );
}

function TierShiftMatrix({ summary }: { summary: SimulationSummary }) {
  const tiers = useMemo(() => {
    const set = new Set<number | null>();
    for (const s of summary.tierShifts) {
      set.add(s.from);
      set.add(s.to);
    }
    return [...set].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
  }, [summary.tierShifts]);

  const count = (from: number | null, to: number | null): number =>
    summary.tierShifts.find((s) => s.from === from && s.to === to)?.count ?? 0;

  if (summary.tierShifts.length === 0) {
    return <p className="text-sm text-gray-400">No tier shifts — every fact set kept its tier.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
              from \ to
            </th>
            {tiers.map((t) => (
              <th key={String(t)} className="px-3 py-2 text-center text-xs font-semibold text-gray-600">
                {tierLabel(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiers.map((from) => (
            <tr key={String(from)}>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">
                {tierLabel(from)}
              </th>
              {tiers.map((to) => {
                const n = count(from, to);
                return (
                  <td
                    key={String(to)}
                    className={cx(
                      "min-w-12 border border-gray-100 px-3 py-2 text-center",
                      n > 0
                        ? from === to
                          ? "bg-gray-50 font-medium text-gray-600"
                          : "bg-indigo-50 font-semibold text-indigo-700"
                        : "text-gray-300"
                    )}
                  >
                    {n > 0 ? n : "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">
        Rows = tier under the baseline policy, columns = tier under the candidate. INC =
        incomplete (engine refused to score).
      </p>
    </div>
  );
}

export function SimulationPage({ id }: { id: string }) {
  const run = useQuery({
    ...simulationQuery(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1500 : false;
    },
  });

  useEffect(() => {
    setLastSimulationId(id);
  }, [id]);

  if (run.isPending) return <Loading label="Loading simulation…" />;
  if (run.isError) return <ErrorNote error={run.error} />;
  const r = run.data;
  const changed = r.results.filter((res) => res.changed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-gray-900">
          Simulation
          <Badge
            tone={
              r.status === "done"
                ? "green"
                : r.status === "failed"
                  ? "red"
                  : "blue"
            }
          >
            {r.status}
          </Badge>
        </h1>
        <p className="mt-1 font-mono text-xs text-gray-400">
          run {r.id} · candidate {shortHash(r.candidateContentHash)} · started{" "}
          {formatDate(r.createdAt)}
          {r.finishedAt ? ` · finished ${formatDate(r.finishedAt)}` : ""}
        </p>
      </div>

      {(r.status === "pending" || r.status === "running") && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-blue-800">
            Replaying stored fact sets under the candidate policy…
          </p>
          <p className="mt-1 text-xs text-blue-600">No LLM involved — pure engine replay.</p>
        </div>
      )}

      {r.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          The simulation run failed. Check the server logs and the candidate YAML.
        </div>
      )}

      {r.status === "done" && r.summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-gray-500">Fact sets replayed</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{r.summary.factSets}</p>
            </Card>
            <Card>
              <p className="text-xs text-gray-500">Outcomes changed</p>
              <p
                className={cx(
                  "mt-1 text-2xl font-bold",
                  r.summary.changed > 0 ? "text-indigo-700" : "text-gray-900"
                )}
              >
                {r.summary.changed}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-gray-500">Newly incomplete</p>
              <p
                className={cx(
                  "mt-1 text-2xl font-bold",
                  r.summary.newlyIncomplete > 0 ? "text-amber-600" : "text-gray-900"
                )}
              >
                {r.summary.newlyIncomplete}
              </p>
            </Card>
          </div>

          <Card title="Tier shift matrix">
            <TierShiftMatrix summary={r.summary} />
          </Card>

          <Card title={`Changed outcomes (${changed.length})`}>
            <Table head={["Request", "Baseline", "", "Candidate"]}>
              {changed.length === 0 && (
                <EmptyRow colSpan={4} message="No outcome changed under the candidate policy." />
              )}
              {changed.map((res) => (
                <tr key={res.factSetId} className="hover:bg-gray-50">
                  <Td>
                    <Link
                      to="/requests/$id"
                      params={{ id: res.requestId }}
                      className="font-mono text-xs text-indigo-600 hover:text-indigo-500"
                    >
                      {res.requestId.slice(0, 8)}…
                    </Link>
                  </Td>
                  <Td>{outcomeCell(res.baseline)}</Td>
                  <Td className="text-gray-400">→</Td>
                  <Td>{outcomeCell(res.candidate)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
