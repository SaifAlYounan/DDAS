import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { AuditCheckpoint, AuditEvent, AuditVerifyResult } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { EmptyRow, Table, Td } from "../components/ui/Table";
import { cx, formatDate, shortHash } from "../lib/format";

const PAGE = 100;

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = JSON.stringify(value);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function AuditPage() {
  const toast = useToast();
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);

  const events = useInfiniteQuery({
    queryKey: ["audit", "events"],
    queryFn: ({ pageParam }) =>
      api.get<AuditEvent[]>(`/audit/events?after=${pageParam}&limit=${PAGE}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last ? last.seq : undefined;
    },
  });

  const verify = useMutation({
    mutationFn: () => api.post<AuditVerifyResult>("/audit/verify"),
    onSuccess: setVerifyResult,
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const checkpoint = useMutation({
    mutationFn: () => api.get<AuditCheckpoint>("/audit/checkpoint"),
    onSuccess: (cp) => {
      const blob = new Blob([JSON.stringify(cp, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ddas-audit-checkpoint-seq${cp.seq}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.push(`Checkpoint exported (seq ${cp.seq})`, "success");
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const all = (events.data?.pages ?? []).flat();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Audit trail</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => checkpoint.mutate()}
            disabled={checkpoint.isPending}
          >
            {checkpoint.isPending ? "Exporting…" : "Download checkpoint"}
          </Button>
          <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? "Verifying…" : "Verify chain"}
          </Button>
        </div>
      </div>

      {verifyResult && (
        <div
          className={cx(
            "rounded-md border px-4 py-3 text-sm",
            verifyResult.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          )}
        >
          {verifyResult.ok ? (
            <>
              Hash chain intact — <strong>{verifyResult.checked}</strong> event(s) verified
              {verifyResult.head && (
                <span className="font-mono text-xs">
                  {" "}
                  · head seq {verifyResult.head.seq} ({shortHash(verifyResult.head.eventHash)})
                </span>
              )}
              .
            </>
          ) : (
            <>
              Chain BROKEN at seq <strong>{verifyResult.firstBadSeq}</strong>:{" "}
              {verifyResult.reason}
            </>
          )}
        </div>
      )}

      {events.isPending && <Loading />}
      {events.isError && <ErrorNote error={events.error} />}
      {events.isSuccess && (
        <>
          <Table head={["Seq", "When", "Type", "Actor", "Entity", "Hash"]}>
            {all.length === 0 && <EmptyRow colSpan={6} message="No audit events." />}
            {all.map((e) => (
              <tr key={e.seq} className="align-top hover:bg-gray-50">
                <Td className="font-mono text-xs text-gray-500">{e.seq}</Td>
                <Td className="text-xs whitespace-nowrap text-gray-500">
                  {formatDate(e.occurredAt)}
                </Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer font-mono text-xs font-medium text-gray-800">
                      {e.type}
                    </summary>
                    <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[11px] leading-snug text-gray-700">
                      {JSON.stringify(e.payload ?? null, null, 2)}
                    </pre>
                  </details>
                </Td>
                <Td className="font-mono text-[11px] text-gray-500">{compactJson(e.actor)}</Td>
                <Td className="font-mono text-[11px] text-gray-500">{compactJson(e.entity)}</Td>
                <Td className="font-mono text-[11px] text-gray-400">{shortHash(e.eventHash, 10)}</Td>
              </tr>
            ))}
          </Table>
          <div className="flex justify-center">
            {events.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void events.fetchNextPage()}
                disabled={events.isFetchingNextPage}
              >
                {events.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              all.length > 0 && <p className="text-xs text-gray-400">End of the trail.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
