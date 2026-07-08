import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { policiesQuery } from "../api/queries";
import { errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { cx, formatBytes } from "../lib/format";

function isAccepted(file: File): boolean {
  return /\.(txt|md)$/i.test(file.name);
}

export function NewRequestPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const policies = useQuery(policiesQuery);

  const [title, setTitle] = useState("");
  const [policySlug, setPolicySlug] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const usablePolicies = (policies.data ?? []).filter((p) => p.activeVersion !== null);

  const addFiles = (incoming: FileList | File[]) => {
    const accepted = Array.from(incoming).filter(isAccepted);
    const skipped = Array.from(incoming).length - accepted.length;
    if (skipped > 0) toast.push(`Skipped ${skipped} file(s) — only .txt and .md are accepted`, "info");
    setFiles((prev) => [...prev, ...accepted]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("title", title);
      form.append("policySlug", policySlug);
      for (const file of files) form.append("files", file, file.name);
      return api.postForm<{ id: string; state: string }>("/requests", form);
    },
    onSuccess: (res) => {
      toast.push("Request submitted — extraction started", "success");
      void navigate({ to: "/requests/$id", params: { id: res.id } });
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const canSubmit =
    title.trim().length > 0 && policySlug.length > 0 && files.length > 0 && !submit.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-gray-900">New request</h1>
      <Card>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit.mutate();
          }}
        >
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kolvarra settlement agreement"
              required
            />
          </Field>

          <Field
            label="Policy"
            hint={
              policies.isSuccess && usablePolicies.length === 0
                ? "No policy with an active version exists yet — activate one under Policies."
                : undefined
            }
          >
            <Select
              value={policySlug}
              onChange={(e) => setPolicySlug(e.target.value)}
              required
            >
              <option value="" disabled>
                {policies.isPending ? "Loading policies…" : "Select a policy"}
              </option>
              {usablePolicies.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.slug} (v{p.activeVersion})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Documents" hint="Plain text (.txt) or Markdown (.md). Facts are extracted with verbatim citations into these documents.">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cx(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
                dragOver
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-gray-300 bg-gray-50 hover:border-gray-400"
              )}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
              }}
            >
              <p className="text-sm font-medium text-gray-700">
                Drop .txt / .md files here or click to browse
              </p>
              <p className="text-xs text-gray-500">One or more documents</p>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".txt,.md,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </Field>

          {files.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate font-medium text-gray-700">{f.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:text-red-500"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => void navigate({ to: "/requests" })}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submit.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
