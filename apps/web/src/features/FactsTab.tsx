import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  ConfirmResult,
  FactRow,
  FactSet,
  FactStatus,
  MissingFacts,
  PatchFactBody,
  RequestDetail,
} from "../api/types";
import { errorMessage } from "../components/Loading";
import { useToast } from "../components/Toast";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { cx, formatFactValue, parseFactValue } from "../lib/format";
import { DocumentPane, type HighlightSpan, type SelectedSpan } from "./DocumentPane";

const STATUS_TONE: Record<FactStatus, BadgeTone> = {
  FOUND: "green",
  NOT_FOUND: "gray",
  MANUAL: "amber",
};

interface EditorState {
  factId: string;
  status: FactStatus;
  value: string;
  unit: string;
  citation: { docIndex: number; start: number; end: number; text: string } | null;
}

export function FactsTab({
  request,
  onClassified,
}: {
  request: RequestDetail;
  onClassified: (result: ConfirmResult) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const factSet: FactSet | undefined = useMemo(
    () => [...request.factSets].sort((a, b) => b.version - a.version)[0],
    [request.factSets]
  );

  const [activeDocIndex, setActiveDocIndex] = useState(
    request.documents[0]?.docIndex ?? 0
  );
  const [highlight, setHighlight] = useState<HighlightSpan | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [missing, setMissing] = useState<MissingFacts | null>(null);

  const factSetId = factSet?.id ?? "";
  const readOnly = factSet !== undefined && factSet.status !== "draft";

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["requests", request.id] });

  const openEditor = (fact: FactRow) => {
    setEditor({
      factId: fact.factId,
      status: fact.status,
      value: fact.value === null || fact.value === undefined ? "" : formatFactValue(fact.value),
      unit: fact.unit ?? "",
      citation: fact.citation
        ? {
            docIndex: fact.citation.docIndex,
            start: fact.citation.start,
            end: fact.citation.end,
            text: fact.citation.text,
          }
        : null,
    });
    if (fact.citation) {
      setActiveDocIndex(fact.citation.docIndex);
      setHighlight({
        docIndex: fact.citation.docIndex,
        start: fact.citation.start,
        end: fact.citation.end,
      });
    }
  };

  const selectRow = (fact: FactRow) => {
    if (fact.citation) {
      setActiveDocIndex(fact.citation.docIndex);
      setHighlight({
        docIndex: fact.citation.docIndex,
        start: fact.citation.start,
        end: fact.citation.end,
      });
    } else {
      setHighlight(null);
    }
  };

  const onSelectSpan = (span: SelectedSpan) => {
    setEditor((prev) =>
      prev && prev.status === "FOUND" ? { ...prev, citation: span } : prev
    );
    setHighlight({ docIndex: span.docIndex, start: span.start, end: span.end });
  };

  const patchFact = useMutation({
    mutationFn: (args: { factId: string; body: PatchFactBody }) =>
      api.patch<FactRow>(`/fact-sets/${factSetId}/facts/${args.factId}`, args.body),
    onSuccess: () => {
      toast.push("Fact updated", "success");
      setEditor(null);
      void invalidate();
    },
    onError: (err) => toast.push(errorMessage(err), "error"),
  });

  const confirm = useMutation({
    mutationFn: () => api.post<ConfirmResult>(`/fact-sets/${factSetId}/confirm`),
    onSuccess: (res) => {
      setConfirmOpen(false);
      void invalidate();
      if (res.status === "INCOMPLETE") {
        setMissing(res.missingFacts ?? []);
        toast.push("Classification is INCOMPLETE — required facts are missing", "error");
      } else {
        setMissing(null);
        toast.push(
          `Classified — Tier ${res.tier ?? "?"}${res.tierName ? ` (${res.tierName})` : ""}`,
          "success"
        );
        onClassified(res);
      }
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.push(errorMessage(err), "error");
    },
  });

  if (!factSet) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        No fact set yet — extraction has not finished.
      </p>
    );
  }

  const saveEditor = () => {
    if (!editor) return;
    let body: PatchFactBody;
    if (editor.status === "FOUND") {
      if (editor.value.trim().length === 0 || !editor.citation) return;
      body = {
        status: "FOUND",
        value: parseFactValue(editor.value),
        citation: {
          docIndex: editor.citation.docIndex,
          start: editor.citation.start,
          end: editor.citation.end,
        },
      };
      if (editor.unit.trim().length > 0) body.unit = editor.unit.trim();
    } else if (editor.status === "MANUAL") {
      if (editor.value.trim().length === 0) return;
      body = { status: "MANUAL", value: parseFactValue(editor.value) };
      if (editor.unit.trim().length > 0) body.unit = editor.unit.trim();
    } else {
      body = { status: "NOT_FOUND" };
    }
    patchFact.mutate({ factId: editor.factId, body });
  };

  const editorValid =
    editor !== null &&
    (editor.status === "NOT_FOUND" ||
      (editor.value.trim().length > 0 &&
        (editor.status === "MANUAL" || editor.citation !== null)));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left pane: facts */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
            <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
              Fact set v{factSet.version} · {factSet.status}
              {factSet.extractionModel ? ` · ${factSet.extractionModel}` : ""}
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {factSet.facts.map((fact) => (
              <li
                key={fact.factId}
                className={cx(
                  "px-4 py-3",
                  fact.citation && "cursor-pointer hover:bg-gray-50",
                  highlight &&
                    fact.citation &&
                    fact.citation.start === highlight.start &&
                    fact.citation.end === highlight.end &&
                    fact.citation.docIndex === highlight.docIndex &&
                    "bg-indigo-50/60"
                )}
                onClick={() => selectRow(fact)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-gray-900">
                    {fact.factId}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[fact.status]}>{fact.status}</Badge>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditor(fact);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                  <span className="font-medium text-gray-800">
                    {formatFactValue(fact.value)}
                    {fact.unit ? <span className="ml-1 text-gray-500">{fact.unit}</span> : null}
                  </span>
                  {fact.confidence !== null && (
                    <span className="text-xs text-gray-400">
                      confidence {(fact.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {fact.attestedBy !== null && (
                    <span className="text-xs text-amber-700">attested by {fact.attestedBy}</span>
                  )}
                </div>
                {fact.citation && (
                  <p className="mt-1 truncate text-xs text-gray-500 italic">
                    “{fact.citation.text}”
                  </p>
                )}
              </li>
            ))}
            {factSet.facts.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-400">
                The fact schema produced no facts.
              </li>
            )}
          </ul>
        </div>

        {editor && (
          <FactEditor
            editor={editor}
            setEditor={setEditor}
            onSave={saveEditor}
            valid={editorValid}
            saving={patchFact.isPending}
          />
        )}

        {missing && missing.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              Classification INCOMPLETE — missing required facts
            </p>
            <ul className="mt-2 space-y-1">
              {missing.map((m) => (
                <li key={m.category} className="text-sm text-amber-800">
                  <span className="font-medium">{m.category}:</span>{" "}
                  <span className="font-mono text-xs">{m.facts.join(", ")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-amber-700">
              Set the missing facts (FOUND with a citation, or MANUAL attested), then confirm the
              new draft fact set.
            </p>
          </div>
        )}

        {!readOnly && (
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">
              Confirming freezes fact set v{factSet.version} and runs classification.
            </p>
            <Button onClick={() => setConfirmOpen(true)} disabled={confirm.isPending}>
              Confirm facts &amp; classify
            </Button>
          </div>
        )}
      </div>

      {/* Right pane: document viewer */}
      <div className="h-[75vh] lg:sticky lg:top-16">
        <DocumentPane
          documents={request.documents}
          activeDocIndex={activeDocIndex}
          onDocChange={setActiveDocIndex}
          highlight={highlight}
          selectionEnabled={editor !== null && editor.status === "FOUND" && !readOnly}
          onSelectSpan={onSelectSpan}
        />
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm facts & classify"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              {confirm.isPending ? "Classifying…" : "Confirm — freeze fact set"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-700">
          This <strong>freezes fact set v{factSet.version}</strong> — its facts become immutable
          and the engine classifies the request from them. To change a fact afterwards you must
          clone the fact set into a new draft.
        </p>
      </Dialog>
    </div>
  );
}

function FactEditor({
  editor,
  setEditor,
  onSave,
  valid,
  saving,
}: {
  editor: EditorState;
  setEditor: (updater: EditorState | null) => void;
  onSave: () => void;
  valid: boolean;
  saving: boolean;
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-4 py-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Edit fact <span className="font-mono">{editor.factId}</span>
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
          Close
        </Button>
      </div>
      <div className="space-y-3">
        <Field label="Status">
          <Select
            value={editor.status}
            onChange={(e) =>
              setEditor({ ...editor, status: e.target.value as FactStatus })
            }
          >
            <option value="FOUND">FOUND — cited from a document</option>
            <option value="MANUAL">MANUAL — attested by you</option>
            <option value="NOT_FOUND">NOT_FOUND — absent from the documents</option>
          </Select>
        </Field>

        {editor.status !== "NOT_FOUND" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Value" hint="Numbers and true/false are stored typed; anything else as text.">
                <Input
                  value={editor.value}
                  onChange={(e) => setEditor({ ...editor, value: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Unit (optional)">
              <Input
                value={editor.unit}
                onChange={(e) => setEditor({ ...editor, unit: e.target.value })}
                placeholder="e.g. USD"
              />
            </Field>
          </div>
        )}

        {editor.status === "FOUND" && (
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-xs font-medium text-gray-700">Citation</p>
            {editor.citation ? (
              <p className="mt-1 text-xs text-gray-600">
                doc #{editor.citation.docIndex}, chars {editor.citation.start}–
                {editor.citation.end}
                <span className="mt-0.5 block truncate text-gray-500 italic">
                  “{editor.citation.text}”
                </span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                Required — select the supporting text in the document pane on the right.
              </p>
            )}
          </div>
        )}

        {editor.status === "MANUAL" && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This fact will be recorded as <strong>attested by you</strong> — it carries your
            identity in the audit trail instead of a document citation.
          </p>
        )}

        {editor.status === "NOT_FOUND" && (
          <p className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            Marking NOT_FOUND clears the value — absence is absence.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={!valid || saving}>
            {saving ? "Saving…" : "Save fact"}
          </Button>
        </div>
      </div>
    </div>
  );
}
