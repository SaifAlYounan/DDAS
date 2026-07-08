/**
 * extractFacts: documents + policy + provider → FactSet + run report.
 *
 * Citation validation is FAIL-CLOSED (the design risk to hold the line on):
 *   1. exact indexOf in the raw document;
 *   2. whitespace-normalized search, mapped back to raw offsets — the stored
 *      citation text is snapped to the raw slice so it is always literally true;
 *   3. one targeted re-ask for only the failed facts;
 *   4. still ungroundable → downgraded to NOT_FOUND and counted in the report.
 * An ungroundable fact must never shape risk; NOT_FOUND flows into the
 * engine's conservative missing-info machinery instead of into a band.
 */
import { z } from "zod";
import type { CompiledPolicy } from "@ddas/policy";
import type { Fact, FactSet } from "@ddas/engine";
import { buildRetryPrompt, buildSystemPrompt, buildUserPrompt, promptHash } from "./prompt.js";
import type { ExtractionProvider } from "./provider.js";

export interface LoadedDoc {
  name: string;
  text: string;
  sha256: string;
}

export interface ExtractionRunReport {
  provider: string;
  model: string;
  promptHash: string;
  factsRequested: number;
  found: number;
  notFound: number;
  manualEntriesIgnored: number;
  undeclaredIdsDropped: string[];
  missingEntriesFilledNotFound: string[];
  citationsRetried: string[];
  citationsDowngraded: string[];
}

const RawFact = z.object({
  id: z.string(),
  // MANUAL is accepted so one stray MANUAL from the model doesn't fail the
  // whole parse; it is dropped (attestation is a human act) and counted.
  status: z.enum(["FOUND", "NOT_FOUND", "MANUAL"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  unit: z.string().optional(),
  confidence: z.number().optional(),
  citation: z.object({ doc_index: z.number().int().nonnegative(), quote: z.string().min(1) }).optional(),
});
const RawOutput = z.object({ facts: z.array(RawFact) });
type RawFactT = z.infer<typeof RawFact>;

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

function parseModelJson(text: string): z.infer<typeof RawOutput> {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const parsed = RawOutput.safeParse(JSON.parse(stripped));
  if (!parsed.success) throw new ExtractionError(`model output failed schema: ${parsed.error.message}`);
  return parsed.data;
}

/** Locate quote in raw doc: exact, then whitespace-normalized snapped back to raw offsets. */
export function locateQuote(doc: string, quote: string): { span: [number, number]; text: string } | null {
  const exact = doc.indexOf(quote);
  if (exact !== -1) return { span: [exact, exact + quote.length], text: quote };

  // normalized fallback: collapse whitespace runs; map normalized index → raw index
  const rawIdx: number[] = [];
  let norm = "";
  let inWs = false;
  for (let i = 0; i < doc.length; i++) {
    const c = doc[i]!;
    if (/\s/.test(c)) {
      if (!inWs && norm.length > 0) {
        norm += " ";
        rawIdx.push(i);
      }
      inWs = true;
    } else {
      norm += c;
      rawIdx.push(i);
      inWs = false;
    }
  }
  const normQuote = quote.replace(/\s+/g, " ").trim();
  if (normQuote.length === 0) return null;
  const at = norm.indexOf(normQuote);
  if (at === -1) return null;
  const start = rawIdx[at]!;
  const end = rawIdx[at + normQuote.length - 1]! + 1;
  return { span: [start, end], text: doc.slice(start, end) }; // snapped: literally true by construction
}

export async function extractFacts(
  docs: LoadedDoc[],
  policy: CompiledPolicy,
  provider: ExtractionProvider,
  opts: { maxTokens?: number } = {}
): Promise<{ factSet: FactSet; report: ExtractionRunReport }> {
  const maxTokens = opts.maxTokens ?? 4096;
  const system = buildSystemPrompt(policy);
  const declared = new Set(policy.document.fact_schema.map((f) => f.id));

  const report: ExtractionRunReport = {
    provider: provider.id,
    model: provider.model,
    promptHash: promptHash(policy),
    factsRequested: declared.size,
    found: 0,
    notFound: 0,
    manualEntriesIgnored: 0,
    undeclaredIdsDropped: [],
    missingEntriesFilledNotFound: [],
    citationsRetried: [],
    citationsDowngraded: [],
  };

  // First pass — one full retry on unparseable output, then hard failure (not silent).
  let raw: RawFactT[];
  const first = await provider.complete({ system, user: buildUserPrompt(docs), maxTokens });
  try {
    raw = parseModelJson(first).facts;
  } catch {
    const second = await provider.complete({ system, user: buildUserPrompt(docs), maxTokens });
    raw = parseModelJson(second).facts; // throws ExtractionError if still invalid
  }

  const byId = new Map<string, RawFactT>();
  for (const f of raw) {
    if (f.status === "MANUAL") {
      // The model never attests; a human does. Drop and count it.
      report.manualEntriesIgnored += 1;
      continue;
    }
    if (!declared.has(f.id)) {
      report.undeclaredIdsDropped.push(f.id);
      continue;
    }
    if (!byId.has(f.id)) byId.set(f.id, f);
  }

  // Ground citations; collect failures for one targeted re-ask.
  const failed: Array<{ id: string; quote: string }> = [];
  const grounded = new Map<string, Fact>();
  const ground = (f: RawFactT): Fact | null => {
    if (f.status === "NOT_FOUND") return { id: f.id, status: "NOT_FOUND" } as Fact;
    if (f.value === undefined || !f.citation || f.citation.doc_index >= docs.length) return null;
    const located = locateQuote(docs[f.citation.doc_index]!.text, f.citation.quote);
    if (!located) return null;
    return {
      id: f.id,
      status: "FOUND",
      value: f.value,
      ...(f.unit ? { unit: f.unit } : {}),
      ...(f.confidence !== undefined ? { confidence: Math.max(0, Math.min(1, f.confidence)) } : {}),
      citation: { docIndex: f.citation.doc_index, span: located.span, text: located.text },
    } as Fact;
  };

  for (const [id, f] of byId) {
    const fact = ground(f);
    if (fact) grounded.set(id, fact);
    else failed.push({ id, quote: f.citation?.quote ?? "(no citation provided)" });
  }

  if (failed.length > 0) {
    report.citationsRetried = failed.map((f) => f.id);
    try {
      const retry = await provider.complete({
        system,
        user: buildRetryPrompt(docs, failed),
        maxTokens,
      });
      for (const f of parseModelJson(retry).facts) {
        if (!failed.some((x) => x.id === f.id)) continue; // only the re-asked facts
        const fact = ground(f);
        if (fact) grounded.set(f.id, fact);
      }
    } catch {
      // retry pass is best-effort; anything still ungrounded downgrades below
    }
  }

  const facts: Fact[] = [];
  for (const id of declared) {
    const fact = grounded.get(id);
    if (fact) {
      facts.push(fact);
      if (fact.status === "FOUND") report.found++;
      else report.notFound++;
      continue;
    }
    facts.push({ id, status: "NOT_FOUND" } as Fact);
    report.notFound++;
    if (byId.has(id) && byId.get(id)!.status === "FOUND") report.citationsDowngraded.push(id);
    else if (!byId.has(id)) report.missingEntriesFilledNotFound.push(id);
  }

  return {
    factSet: {
      facts,
      extraction: { model: provider.model, promptHash: report.promptHash },
    },
    report,
  };
}
