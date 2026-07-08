import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { LintFinding, LintResult, PolicyVersion } from "../api/types";
import { errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Input";
import { Textarea } from "../components/ui/Textarea";

function extractFindings(err: unknown): LintFinding[] | null {
  if (
    err instanceof ApiError &&
    typeof err.details === "object" &&
    err.details !== null &&
    "findings" in err.details &&
    Array.isArray((err.details as { findings: unknown }).findings)
  ) {
    return (err.details as { findings: LintFinding[] }).findings;
  }
  return null;
}

export function FindingsList({ findings }: { findings: LintFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-md border border-red-200 bg-red-50 px-4 py-3">
      {findings.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <Badge tone={f.severity === "error" ? "red" : "amber"}>{f.severity}</Badge>
          <span className="text-gray-800">
            <span className="font-mono text-xs text-gray-500">{f.path}</span> — {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** YAML draft editor with lint — used for both new policies and new versions. */
export function PolicyDraftForm({
  fixedSlug,
  onCreated,
}: {
  fixedSlug?: string;
  onCreated: (version: PolicyVersion, slug: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState(fixedSlug ?? "");
  const [yaml, setYaml] = useState("");
  const [findings, setFindings] = useState<LintFinding[] | null>(null);
  const [lintOkFor, setLintOkFor] = useState<string | null>(null);

  const lint = useMutation({
    mutationFn: () => api.post<LintResult>("/policies/lint", { sourceYaml: yaml }),
    onSuccess: (res) => {
      setFindings(res.findings);
      setLintOkFor(res.ok && !res.findings.some((f) => f.severity === "error") ? yaml : null);
      if (res.ok && res.findings.length === 0) toast.push("Lint clean", "success");
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<PolicyVersion>(`/policies/${encodeURIComponent(slug)}/versions`, {
        sourceYaml: yaml,
      }),
    onSuccess: (version) => {
      toast.push(`Draft v${version.version} created`, "success");
      void queryClient.invalidateQueries({ queryKey: ["policies"] });
      onCreated(version, slug);
    },
    onError: (err) => {
      const fromError = extractFindings(err);
      if (fromError) {
        setFindings(fromError);
        toast.push("Policy failed lint — fix the findings below", "error");
      } else {
        toast.push(errorMessage(err), "error");
      }
    },
  });

  const blockingErrors = (findings ?? []).some((f) => f.severity === "error");
  const canCreate =
    slug.trim().length > 0 && yaml.trim().length > 0 && !blockingErrors && !create.isPending;

  return (
    <div className="space-y-4">
      {fixedSlug === undefined && (
        <Field label="Policy slug" hint="Lowercase identifier, e.g. procurement-doa">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-policy" />
        </Field>
      )}
      <Field label="Policy YAML">
        <Textarea
          mono
          rows={18}
          value={yaml}
          onChange={(e) => {
            setYaml(e.target.value);
            if (lintOkFor !== null && e.target.value !== lintOkFor) setLintOkFor(null);
          }}
          placeholder="# risk_policy/v1 …"
          spellCheck={false}
        />
      </Field>
      {findings && findings.length > 0 && <FindingsList findings={findings} />}
      {findings && findings.length === 0 && (
        <p className="text-sm text-green-700">No findings — the policy compiles clean.</p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => lint.mutate()}
          disabled={yaml.trim().length === 0 || lint.isPending}
        >
          {lint.isPending ? "Linting…" : "Lint"}
        </Button>
        <Button onClick={() => create.mutate()} disabled={!canCreate}>
          {create.isPending ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </div>
  );
}
