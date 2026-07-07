/**
 * The extraction prompt contract. The system prompt embeds the policy's fact
 * schema; promptHash = sha256 over the rendered system prompt and is recorded
 * in every FactSet for reproducibility (pinned per release).
 */
import { createHash } from "node:crypto";
import type { CompiledPolicy } from "@ddas/policy";

export const PROMPT_VERSION = "extract-v1";

export function buildSystemPrompt(policy: CompiledPolicy): string {
  const factLines = policy.document.fact_schema
    .map((f) => {
      const parts = [`- id: ${f.id}`, `type: ${f.type}`];
      if (f.unit) parts.push(`unit: ${f.unit}`);
      if (f.values) parts.push(`allowed values: ${f.values.join(" | ")}`);
      if (f.description) parts.push(`— ${f.description}`);
      return parts.join(", ");
    })
    .join("\n");

  return `You are a fact extractor for a governance system (${PROMPT_VERSION}). You read transaction documents and emit typed facts. You never assess risk, never score, never advise — you only report what the documents literally state.

FACT SCHEMA (emit exactly one JSON object per fact id below):
${factLines}

RULES — these are absolute:
1. Output ONLY a JSON object: {"facts": [ ... ]} — no prose, no markdown fences.
2. Each entry: {"id": "<fact id>", "status": "FOUND" | "NOT_FOUND", "value"?, "unit"?, "confidence"?, "citation"?: {"doc_index": <n>, "quote": "<verbatim substring>"}}.
3. "FOUND" requires "value" AND "citation". The "quote" MUST be a verbatim substring of the cited document — copy it exactly, character for character.
4. If the documents do not state a fact, return "NOT_FOUND". NEVER infer, NEVER guess, NEVER compute values that are not explicitly stated — with ONE exception: when a total is explicitly decomposed across the documents (e.g. a base fee plus committed schedule amounts), you may sum the stated components; cite the primary component and set "confidence" accordingly.
5. Money values: emit the number and the ISO currency as "unit" exactly as stated in the document. Do not convert currencies.
6. Boolean facts: true/false only when the document clearly establishes it; otherwise NOT_FOUND. Vague language ("may revisit the arrangement") is NOT a stated right — return NOT_FOUND.
7. Enum facts: use one of the allowed values only.
8. "confidence" is a number 0..1 reflecting how directly the document states the fact.`;
}

export function buildUserPrompt(docs: Array<{ name: string; text: string }>): string {
  return docs.map((d, i) => `=== DOCUMENT ${i}: ${d.name} ===\n${d.text}`).join("\n\n");
}

export function buildRetryPrompt(
  docs: Array<{ name: string; text: string }>,
  failed: Array<{ id: string; quote: string }>
): string {
  const list = failed.map((f) => `- ${f.id}: your quote was not a verbatim substring: "${f.quote}"`).join("\n");
  return `${buildUserPrompt(docs)}

Your previous answer cited quotes that do not appear verbatim in the documents:
${list}

Re-emit ONLY these facts (same JSON shape, {"facts":[...]}), each with an EXACT verbatim substring as the quote — or "NOT_FOUND" if you cannot ground the fact. Do not re-emit other facts.`;
}

export function promptHash(policy: CompiledPolicy): string {
  return "sha256:" + createHash("sha256").update(buildSystemPrompt(policy), "utf8").digest("hex");
}
