/**
 * Corpus loading + engine replay — harnesses #2 and #3 of the testkit README.
 * Shared by corpus.test.ts and the CLI's `ddas eval --engine`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classify, type ClassificationResult, type Fact, type FactSet, type Subject } from "@ddas/engine";
import { compilePolicy, type CompiledPolicy } from "@ddas/policy";
import type { LabeledFact } from "./metrics.js";

export interface CorpusCase {
  case_id: string;
  description?: string;
  tags?: string[];
  documents: Array<{ path: string; sha256: string }>;
  labeled_facts: LabeledFact[];
  expected_routing?: {
    policy_ref: { policy_id: string; version: number };
    expected:
      | { status: "ROUTED"; tier: number; binding_category?: string; triggers_fired?: string[] }
      | { status: "INCOMPLETE"; missing_facts: string[] };
    initiator_kind?: "human" | "agent";
  };
}

export interface LoadedCase {
  case: CorpusCase;
  docs: Array<{ name: string; text: string; sha256: string }>;
}

export interface LoadedCorpus {
  root: string;
  policy: CompiledPolicy;
  cases: LoadedCase[];
}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadCorpus(root: string): LoadedCorpus {
  const policyDir = join(root, "policy");
  const policyFile = readdirSync(policyDir).find((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (!policyFile) throw new Error(`no policy yaml under ${policyDir}`);
  const policy = compilePolicy(readFileSync(join(policyDir, policyFile), "utf8"));

  const casesDir = join(root, "cases");
  const cases: LoadedCase[] = readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const c = JSON.parse(readFileSync(join(casesDir, f), "utf8")) as CorpusCase;
      const docs = c.documents.map((d) => {
        const text = readFileSync(join(root, d.path), "utf8");
        return { name: d.path, text, sha256: sha256Of(text) };
      });
      return { case: c, docs };
    });
  return { root, policy, cases };
}

/**
 * Labels → a FactSet the engine can classify: FOUND labels are grounded at
 * their citation's location; for agent-initiated replays, facts the policy
 * requires attested become MANUAL (the corpus models a compliant agent flow).
 */
export function labeledFactSet(loaded: LoadedCase, policy: CompiledPolicy, initiatorKind: "human" | "agent"): FactSet {
  const attestationIds = new Set(
    policy.compiled.agent.attestationFactIdxs.map((i) => policy.compiled.factTable[i]!.id)
  );
  const facts: Fact[] = loaded.case.labeled_facts.map((label): Fact => {
    if (label.status === "NOT_FOUND") return { id: label.id, status: "NOT_FOUND" } as Fact;
    if (initiatorKind === "agent" && attestationIds.has(label.id)) {
      return { id: label.id, status: "MANUAL", value: label.value, ...(label.unit ? { unit: label.unit } : {}), attestedBy: "user:owner" } as Fact;
    }
    const docIndex = label.citation?.doc_index ?? 0;
    const doc = loaded.docs[docIndex];
    const quote = label.citation?.text ?? "";
    const at = doc && quote ? doc.text.indexOf(quote) : -1;
    if (at === -1) {
      throw new Error(
        `case ${loaded.case.case_id}: label '${label.id}' citation text not found verbatim in ${doc?.name ?? `doc ${docIndex}`}`
      );
    }
    return {
      id: label.id,
      status: "FOUND",
      value: label.value,
      ...(label.unit ? { unit: label.unit } : {}),
      confidence: 1,
      citation: { docIndex, span: [at, at + quote.length], text: quote },
    } as Fact;
  });
  return { facts };
}

export function replayCase(loaded: LoadedCase, policy: CompiledPolicy): ClassificationResult {
  const kind = loaded.case.expected_routing?.initiator_kind ?? "human";
  const actionType = loaded.case.labeled_facts.find((f) => f.id === "action_type" && f.status === "FOUND")?.value;
  const subject: Subject = {
    initiatorKind: kind,
    initiator: kind === "agent" ? "agent:corpus" : "user:corpus",
    ...(kind === "agent" ? { onBehalfOf: "user:corpus" } : {}),
    ...(typeof actionType === "string" ? { actionType } : {}),
  };
  return classify({
    factSet: labeledFactSet(loaded, policy, kind),
    policy,
    subject,
    documents: loaded.docs.map((d) => ({ name: d.name, sha256: d.sha256 })),
  });
}
