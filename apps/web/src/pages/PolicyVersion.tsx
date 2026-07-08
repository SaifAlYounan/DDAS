import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { policiesQuery, policyVersionQuery, policyVersionsQuery } from "../api/queries";
import type { DiffChange, PolicyVersion } from "../api/types";
import { ErrorNote, Loading, errorMessage } from "../components/Loading";
import { hasRole, useMe } from "../components/MeContext";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import { FindingsList } from "../features/PolicyDraftForm";
import { formatDate, shortHash } from "../lib/format";
import { getLastSimulationId, setLastSimulationId } from "../lib/lastSimulation";
import { VERSION_TONE } from "./Policies";

const diffQuery = (id: string, otherId: string) =>
  queryOptions({
    queryKey: ["policy-versions", id, "diff", otherId],
    queryFn: () =>
      api.get<{ changes: DiffChange[] }>(`/policy-versions/${id}/diff/${otherId}`),
  });

export function PolicyVersionPage({ id }: { id: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isAuthor = hasRole(me, "policy_author");

  const version = useQuery(policyVersionQuery(id));
  const policies = useQuery(policiesQuery);

  const slug = useMemo(() => {
    if (!version.data || !policies.data) return null;
    return policies.data.find((p) => p.id === version.data.policyId)?.slug ?? null;
  }, [version.data, policies.data]);

  const siblings = useQuery({
    ...policyVersionsQuery(slug ?? "none"),
    enabled: slug !== null,
  });

  const [diffAgainst, setDiffAgainst] = useState("");
  const diff = useQuery({
    ...diffQuery(id, diffAgainst),
    enabled: diffAgainst.length > 0,
  });

  const [activateOpen, setActivateOpen] = useState(false);

  const activeVersion: PolicyVersion | undefined = (siblings.data ?? []).find(
    (v) => v.status === "active"
  );

  const simulate = useMutation({
    mutationFn: () => {
      if (!activeVersion || !version.data) throw new Error("no active baseline version");
      return api.post<{ id: string; status: string }>("/simulations", {
        baselinePolicyVersionId: activeVersion.id,
        candidateYaml: version.data.sourceYaml,
      });
    },
    onSuccess: (res) => {
      setLastSimulationId(res.id);
      toast.push("Simulation started", "success");
      void navigate({ to: "/simulations/$id", params: { id: res.id } });
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  if (version.isPending) return <Loading />;
  if (version.isError) return <ErrorNote error={version.error} />;
  const v = version.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-gray-500">
            <Link to="/policies" className="text-indigo-600 hover:text-indigo-500">
              Policies
            </Link>
            {slug && (
              <>
                {" / "}
                <Link
                  to="/policies/$slug"
                  params={{ slug }}
                  className="text-indigo-600 hover:text-indigo-500"
                >
                  {slug}
                </Link>
              </>
            )}{" "}
            /
          </p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-gray-900">
            Version {v.version}
            <Badge tone={VERSION_TONE[v.status]}>{v.status}</Badge>
          </h1>
          <p className="mt-1 font-mono text-xs text-gray-400">
            {shortHash(v.contentHash, 20)} · created {formatDate(v.createdAt)}
            {v.activatedAt ? ` · activated ${formatDate(v.activatedAt)}` : ""}
          </p>
          {v.activationOverrideReason && (
            <p className="mt-1 text-xs text-amber-700">
              Activated with override: “{v.activationOverrideReason}”
            </p>
          )}
        </div>
        {isAuthor && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => simulate.mutate()}
              disabled={simulate.isPending || !activeVersion || activeVersion.id === v.id}
              title={
                !activeVersion
                  ? "No active baseline version to simulate against"
                  : activeVersion.id === v.id
                    ? "This version is already active"
                    : undefined
              }
            >
              {simulate.isPending ? "Starting…" : "Simulate vs active"}
            </Button>
            {v.status === "draft" && (
              <Button onClick={() => setActivateOpen(true)}>Activate…</Button>
            )}
          </div>
        )}
      </div>

      {v.findings.length > 0 && <FindingsList findings={v.findings} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Source YAML (read-only)">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-gray-50 p-4 font-mono text-xs leading-relaxed whitespace-pre text-gray-800">
              {v.sourceYaml}
            </pre>
          </Card>
        </div>

        <Card title="Structural diff">
          <div className="space-y-3">
            <Select value={diffAgainst} onChange={(e) => setDiffAgainst(e.target.value)}>
              <option value="">Compare with version…</option>
              {(siblings.data ?? [])
                .filter((s) => s.id !== v.id)
                .sort((a, b) => b.version - a.version)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    v{s.version} ({s.status})
                  </option>
                ))}
            </Select>
            {diff.isFetching && <Loading label="Diffing…" />}
            {diff.isError && <ErrorNote error={diff.error} />}
            {diff.isSuccess && (
              <ul className="space-y-1">
                {diff.data.changes.length === 0 && (
                  <li className="text-sm text-gray-400">Structurally identical.</li>
                )}
                {diff.data.changes.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <Badge
                      tone={
                        c.change === "added" ? "green" : c.change === "removed" ? "red" : "amber"
                      }
                    >
                      {c.change}
                    </Badge>
                    <span className="font-mono text-xs text-gray-700">{c.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <ActivateDialog
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        versionId={v.id}
        onActivated={() => {
          setActivateOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["policy-versions", id] });
          void queryClient.invalidateQueries({ queryKey: ["policies"] });
        }}
      />
    </div>
  );
}

function ActivateDialog({
  open,
  onClose,
  versionId,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  versionId: string;
  onActivated: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"simulation" | "override">("simulation");
  const [simId, setSimId] = useState(getLastSimulationId() ?? "");
  const [reason, setReason] = useState("");

  const activate = useMutation({
    mutationFn: () =>
      api.post<PolicyVersion>(
        `/policy-versions/${versionId}/activate`,
        mode === "simulation" ? { simulationRunId: simId.trim() } : { overrideReason: reason.trim() }
      ),
    onSuccess: (v) => {
      toast.push(`Version ${v.version} is now active`, "success");
      onActivated();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const valid =
    mode === "simulation" ? simId.trim().length > 0 : reason.trim().length >= 10;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Activate policy version"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => activate.mutate()} disabled={!valid || activate.isPending}>
            {activate.isPending ? "Activating…" : "Activate"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Activation requires either a <strong>completed simulation run</strong> against the
          current active version, or an explicit override reason (recorded in the audit trail).
        </p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              checked={mode === "simulation"}
              onChange={() => setMode("simulation")}
              className="accent-indigo-600"
            />
            Use a simulation run
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              checked={mode === "override"}
              onChange={() => setMode("override")}
              className="accent-indigo-600"
            />
            Override
          </label>
        </div>
        {mode === "simulation" ? (
          <Field label="Simulation run id" hint="A completed run started from this version.">
            <Input value={simId} onChange={(e) => setSimId(e.target.value)} className="font-mono" />
          </Field>
        ) : (
          <Field label="Override reason" hint="Minimum 10 characters — this is audited.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
