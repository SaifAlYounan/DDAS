/**
 * Command implementations — exported as plain functions so tests exercise them
 * without spawning processes. main.ts wires them to commander.
 */
import { readFileSync } from "node:fs";
import { classify, type ClassificationResult, type FactSet, type Subject } from "@ddas/engine";
import { extractFacts, loadDocument, providerFromEnv } from "@ddas/extraction";
import {
  compilePolicy,
  PolicyCompileError,
  lintPolicy,
  type CompiledPolicy,
  type LintFinding,
} from "@ddas/policy";
import { buildScoreboard, loadCorpus, replayCase, scoreCase } from "@ddas/testkit";
import type { Store } from "./store.js";

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

// ---------- policy ----------

export function cmdPolicyLint(file: string, out: Output): number {
  const source = readFileSync(file, "utf8");
  let findings: LintFinding[] = [];
  let compiled: CompiledPolicy | null = null;
  try {
    compiled = compilePolicy(source);
    findings = lintPolicy(compiled.document); // surface warnings even on success
  } catch (e) {
    if (!(e instanceof PolicyCompileError)) throw e;
    findings = e.findings;
  }
  for (const f of findings) out.log(`${f.severity.toUpperCase().padEnd(7)} ${f.path}: ${f.message}`);
  const errors = findings.filter((f) => f.severity === "error").length;
  if (compiled && errors === 0) {
    out.log(`OK ${compiled.policyId}@${compiled.version} ${compiled.contentHash} (${findings.length} warning${findings.length === 1 ? "" : "s"})`);
    return 0;
  }
  out.error(`${errors} error(s)`);
  return 1;
}

export function cmdPolicyRegister(file: string, store: Store, out: Output): number {
  const compiled = compilePolicy(readFileSync(file, "utf8"));
  const { alreadyRegistered } = store.registerPolicy(compiled);
  out.log(
    `${alreadyRegistered ? "already registered" : "registered"} ${compiled.policyId}@${compiled.version} ${compiled.contentHash}`
  );
  return 0;
}

export function cmdPolicyActivate(ref: string, store: Store, out: Output): number {
  const compiled = store.loadPolicy(ref);
  const hash8 = compiled.contentHash.replace("sha256:", "").slice(0, 8);
  if (!store.hasSimulationReportFor(hash8)) {
    out.log(
      `WARNING: no simulation report found for ${ref} (${hash8}) — activating without simulation. ` +
        `Run 'ddas simulate' first; in the Phase 2 platform this requires an audited override.`
    );
  }
  store.activatePolicy(ref);
  out.log(`active: ${ref}`);
  return 0;
}

export function cmdPolicyList(store: Store, out: Output): number {
  const rows = store.listPolicies();
  if (rows.length === 0) out.log("no policies registered");
  for (const r of rows) out.log(`${r.active ? "* " : "  "}${r.id}@${r.version} ${r.contentHash}`);
  return 0;
}

export function cmdPolicyShow(ref: string, store: Store, out: Output): number {
  const p = store.loadPolicy(ref);
  out.log(JSON.stringify({ policyId: p.policyId, version: p.version, contentHash: p.contentHash, document: p.document }, null, 2));
  return 0;
}

// ---------- submit / classify ----------

export interface SubmitOptions {
  facts?: string;
  extract?: boolean;
  initiator: string;
  onBehalfOf?: string;
  actionType?: string;
}

export async function cmdSubmit(docPaths: string[], opts: SubmitOptions, store: Store, out: Output): Promise<number> {
  const isAgent = opts.initiator.startsWith("agent:");
  if (isAgent && !opts.onBehalfOf) {
    out.error("agent submissions require --on-behalf-of user:<owner>");
    return 1;
  }
  const subject: Subject = {
    initiatorKind: isAgent ? "agent" : "human",
    initiator: opts.initiator,
    ...(opts.onBehalfOf ? { onBehalfOf: opts.onBehalfOf } : {}),
    ...(opts.actionType ? { actionType: opts.actionType } : {}),
  };
  const manifest = store.createSubmission(docPaths, subject);
  out.log(`submission ${manifest.id} (${manifest.documents.length} document(s))`);

  if (opts.facts) {
    const factSet = JSON.parse(readFileSync(opts.facts, "utf8")) as FactSet;
    store.writeFactSet(manifest.id, factSet);
    out.log(`fact set: ${factSet.facts.length} facts (from ${opts.facts})`);
  } else if (opts.extract) {
    const ref = store.activeRef();
    if (!ref) {
      out.error("no active policy — extraction needs the policy's fact schema (ddas policy activate <id>@<v>)");
      return 1;
    }
    const policy = store.loadPolicy(ref);
    const docs = docPaths.map((p) => loadDocument(p));
    const provider = providerFromEnv();
    out.log(`extracting with ${provider.id}/${provider.model} …`);
    const { factSet, report } = await extractFacts(docs, policy, provider);
    store.writeFactSet(manifest.id, factSet);
    out.log(
      `fact set: ${report.found} found, ${report.notFound} not found` +
        (report.citationsDowngraded.length ? `, downgraded (ungroundable citations): ${report.citationsDowngraded.join(", ")}` : "")
    );
  } else {
    out.log("no facts yet — provide --facts <file.json> or --extract");
  }
  return 0;
}

export function cmdClassify(submissionId: string, policyRef: string | undefined, store: Store, out: Output): number {
  const ref = policyRef ?? store.activeRef();
  if (!ref) {
    out.error("no policy specified and none active");
    return 1;
  }
  const policy = store.loadPolicy(ref);
  const manifest = store.loadManifest(submissionId);
  const factSet = store.loadFactSet(submissionId);
  const result = classify({ factSet, policy, subject: manifest.subject, documents: manifest.documents });
  const path = store.writeClassification(submissionId, result);
  if (result.status === "ROUTED") {
    out.log(`ROUTED → tier ${result.tier} (${result.tierName})`);
    out.log(result.derivation.explanation);
  } else {
    out.log(`INCOMPLETE — missing:`);
    for (const m of result.missingFacts) out.log(`  ${m.category}: ${m.facts.join(", ")}`);
    out.log(result.derivation.explanation);
  }
  out.log(`derivation: ${path}`);
  return 0;
}

// ---------- simulate ----------

export function cmdSimulate(draftFile: string, against: string | undefined, store: Store, out: Output): number {
  const draft = compilePolicy(readFileSync(draftFile, "utf8"));
  const baselineRef = against && against !== "active" ? against : store.activeRef();
  if (!baselineRef) {
    out.error("no baseline: activate a policy or pass --against <id>@<v>");
    return 1;
  }
  const baseline = store.loadPolicy(baselineRef);

  const rows: Array<{
    submission: string;
    before: string;
    after: string;
    shifted: boolean;
    newlyIncomplete: boolean;
    bindingAfter?: string;
  }> = [];
  for (const id of store.listSubmissions()) {
    let factSet: FactSet;
    try {
      factSet = store.loadFactSet(id);
    } catch {
      continue; // no facts yet — nothing to replay
    }
    const manifest = store.loadManifest(id);
    const run = (p: CompiledPolicy): ClassificationResult =>
      classify({ factSet, policy: p, subject: manifest.subject, documents: manifest.documents });
    const b = run(baseline);
    const a = run(draft);
    const label = (r: ClassificationResult) => (r.status === "ROUTED" ? `T${r.tier}` : "INCOMPLETE");
    rows.push({
      submission: id,
      before: label(b),
      after: label(a),
      shifted: label(b) !== label(a),
      newlyIncomplete: b.status === "ROUTED" && a.status === "INCOMPLETE",
      ...(a.status === "ROUTED" ? { bindingAfter: a.derivation.composition!.baseTier.bindingCategory } : {}),
    });
  }

  const shifted = rows.filter((r) => r.shifted);
  const newlyIncomplete = rows.filter((r) => r.newlyIncomplete);
  for (const r of rows) {
    out.log(`${r.submission}  ${r.before} → ${r.after}${r.shifted ? "  *" : ""}${r.bindingAfter ? `  (${r.bindingAfter})` : ""}`);
  }
  out.log(
    `${shifted.length} of ${rows.length} submissions change under ${draft.policyId}@${draft.version}` +
      (newlyIncomplete.length ? `; ${newlyIncomplete.length} newly INCOMPLETE — the draft requires facts not yet captured` : "")
  );

  const draftHash8 = draft.contentHash.replace("sha256:", "").slice(0, 8);
  const baseHash8 = baseline.contentHash.replace("sha256:", "").slice(0, 8);
  const path = store.writeSimulationReport(`${draftHash8}--vs--${baseHash8}`, {
    draft: { ref: `${draft.policyId}@${draft.version}`, contentHash: draft.contentHash },
    baseline: { ref: baselineRef, contentHash: baseline.contentHash },
    total: rows.length,
    shifted: shifted.length,
    newlyIncomplete: newlyIncomplete.length,
    rows,
  });
  out.log(`report: ${path}`);
  return 0;
}

// ---------- eval ----------

export async function cmdEval(
  opts: { engine?: boolean; extraction?: boolean; corpus: string; out?: string },
  output: Output
): Promise<number> {
  const corpus = loadCorpus(opts.corpus);
  let failures = 0;

  if (opts.engine !== false) {
    for (const loaded of corpus.cases) {
      const exp = loaded.case.expected_routing;
      if (!exp) continue;
      const result = replayCase(loaded, corpus.policy);
      const pass =
        result.status === exp.expected.status &&
        (exp.expected.status !== "ROUTED" || (result.status === "ROUTED" && result.tier === exp.expected.tier));
      if (!pass) failures++;
      output.log(
        `${pass ? "PASS" : "FAIL"} ${loaded.case.case_id}: ${result.status}${result.status === "ROUTED" ? ` T${result.tier}` : ""}`
      );
    }
  }

  if (opts.extraction) {
    const provider = providerFromEnv();
    output.log(`extraction eval with ${provider.id}/${provider.model} over ${corpus.cases.length} cases …`);
    const factTypes = Object.fromEntries(corpus.policy.document.fact_schema.map((f) => [f.id, f.type]));
    const caseScores = [];
    for (const loaded of corpus.cases) {
      const { factSet } = await extractFacts(
        loaded.docs.map((d) => ({ name: d.name, text: d.text, sha256: d.sha256 })),
        corpus.policy,
        provider
      );
      caseScores.push(scoreCase(loaded.case.labeled_facts, factSet.facts, loaded.docs.map((d) => d.text)));
      output.log(`  scored ${loaded.case.case_id}`);
    }
    const board = buildScoreboard(caseScores, factTypes);
    const json = JSON.stringify({ provider: provider.id, model: provider.model, ...board }, null, 2);
    if (opts.out) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(opts.out, json + "\n");
      output.log(`scoreboard: ${opts.out}`);
    } else {
      output.log(json);
    }
    output.log(
      `headline falseFactRate: ${board.headline.falseFactRate.toFixed(3)} · precision ${board.aggregate.precision.toFixed(3)} · recall ${board.aggregate.recall.toFixed(3)} · citation fidelity ${board.aggregate.citationFidelity.toFixed(3)}`
    );
  }

  return failures === 0 ? 0 : 1;
}
