import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { documentTextQuery } from "../api/queries";
import type { DocumentMeta } from "../api/types";
import { ErrorNote, Loading } from "../components/Loading";
import { cx } from "../lib/format";

export interface HighlightSpan {
  docIndex: number;
  start: number;
  end: number;
}

export interface SelectedSpan {
  docIndex: number;
  start: number;
  end: number;
  text: string;
}

/** Absolute character offset of (node, offsetInNode) within container's text. */
function offsetWithin(container: Node, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  // `node` may be the container itself (offset counts child nodes) — treat as unsupported.
  return null;
}

export function DocumentPane({
  documents,
  activeDocIndex,
  onDocChange,
  highlight,
  selectionEnabled,
  onSelectSpan,
}: {
  documents: DocumentMeta[];
  activeDocIndex: number;
  onDocChange: (docIndex: number) => void;
  highlight: HighlightSpan | null;
  selectionEnabled: boolean;
  onSelectSpan: (span: SelectedSpan) => void;
}) {
  const activeDoc = documents.find((d) => d.docIndex === activeDocIndex) ?? documents[0];
  const textQuery = useQuery({
    ...documentTextQuery(activeDoc?.id ?? "none"),
    enabled: activeDoc !== undefined,
  });

  const markRef = useRef<HTMLElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  const showHighlight =
    highlight !== null && activeDoc !== undefined && highlight.docIndex === activeDoc.docIndex;

  useEffect(() => {
    if (showHighlight && markRef.current) {
      markRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showHighlight, highlight?.start, highlight?.end, textQuery.data]);

  const handleMouseUp = () => {
    if (!selectionEnabled || !preRef.current || activeDoc === undefined) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!preRef.current.contains(range.startContainer) || !preRef.current.contains(range.endContainer)) {
      return;
    }
    const a = offsetWithin(preRef.current, range.startContainer, range.startOffset);
    const b = offsetWithin(preRef.current, range.endContainer, range.endOffset);
    if (a === null || b === null || a === b) return;
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const text = (textQuery.data?.text ?? "").slice(start, end);
    if (text.length === 0) return;
    onSelectSpan({ docIndex: activeDoc.docIndex, start, end, text });
  };

  if (documents.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No documents.</p>;
  }

  const text = textQuery.data?.text ?? "";
  let body;
  if (showHighlight && text.length > 0) {
    const start = Math.max(0, Math.min(highlight.start, text.length));
    const end = Math.max(start, Math.min(highlight.end, text.length));
    body = (
      <>
        {text.slice(0, start)}
        <mark
          ref={markRef}
          className="rounded-sm bg-indigo-200 px-0.5 text-gray-900 ring-1 ring-indigo-400"
        >
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </>
    );
  } else {
    body = text;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50 px-2 py-1.5">
        {documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => onDocChange(doc.docIndex)}
            className={cx(
              "rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap",
              doc.docIndex === activeDoc?.docIndex
                ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {doc.name}
          </button>
        ))}
      </div>
      {selectionEnabled && (
        <p className="border-b border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700">
          Selection mode — highlight text in the document to set the citation span.
        </p>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {textQuery.isPending && <Loading label="Loading document…" />}
        {textQuery.isError && <ErrorNote error={textQuery.error} />}
        {textQuery.isSuccess && (
          <pre
            ref={preRef}
            onMouseUp={handleMouseUp}
            className={cx(
              "font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-gray-800",
              selectionEnabled && "cursor-text select-text"
            )}
          >
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}
