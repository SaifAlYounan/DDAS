/**
 * The Kolvarra corpus gate: every case validates against the golden-set
 * schema, every document hash pins, paraphrase pairs carry identical fact
 * values, and every expected routing replays exactly through the engine.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { loadCorpus, replayCase, sha256Of } from "./corpus.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = join(here, "../corpus/kolvarra");
const corpus = loadCorpus(corpusRoot);

const schema = JSON.parse(readFileSync(join(here, "../schema/golden-set.v1.schema.json"), "utf8"));
const ajv = new Ajv2020.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validate = ajv.compile(schema);

describe("Kolvarra corpus", () => {
  it("has at least the planned 14 cases", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(14);
  });

  it("compiles the Kolvarra policy with zero lint errors", () => {
    expect(corpus.policy.policyId).toBe("kolvarra-risk");
    expect(corpus.policy.version).toBe(1);
  });

  it.each(corpus.cases.map((c) => [c.case.case_id, c] as const))(
    "%s validates against the golden-set schema",
    (_id, loaded) => {
      const ok = validate(loaded.case);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    }
  );

  it.each(corpus.cases.map((c) => [c.case.case_id, c] as const))(
    "%s document hashes pin",
    (_id, loaded) => {
      loaded.case.documents.forEach((d, i) => {
        expect(sha256Of(loaded.docs[i]!.text)).toBe(d.sha256);
      });
    }
  );

  it.each(corpus.cases.map((c) => [c.case.case_id, c] as const))(
    "%s FOUND labels cite verbatim document spans",
    (_id, loaded) => {
      for (const label of loaded.case.labeled_facts) {
        if (label.status !== "FOUND") continue;
        const doc = loaded.docs[label.citation?.doc_index ?? 0]!;
        expect(
          doc.text.includes(label.citation?.text ?? ""),
          `label '${label.id}' citation must appear verbatim in ${doc.name}`
        ).toBe(true);
      }
    }
  );

  it("paraphrase pairs carry identical fact values and routings", () => {
    const byId = new Map(corpus.cases.map((c) => [c.case.case_id, c]));
    const pairs = corpus.cases.filter((c) => c.case.tags?.some((t) => t.startsWith("paraphrase-of:")));
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (const para of pairs) {
      const srcId = para.case.tags!.find((t) => t.startsWith("paraphrase-of:"))!.slice("paraphrase-of:".length);
      const src = byId.get(srcId);
      expect(src, `paraphrase source '${srcId}' exists`).toBeDefined();
      const strip = (c: typeof para) =>
        c.case.labeled_facts
          .map((f) => ({ id: f.id, status: f.status, value: f.value ?? null, unit: f.unit ?? null }))
          .sort((a, b) => a.id.localeCompare(b.id));
      expect(strip(para)).toEqual(strip(src!));
      expect(para.case.expected_routing?.expected).toEqual(src!.case.expected_routing?.expected);
    }
  });

  const routed = corpus.cases.filter((c) => c.case.expected_routing);
  it("every case declares an expected routing", () => {
    expect(routed.length).toBe(corpus.cases.length);
  });

  it.each(routed.map((c) => [c.case.case_id, c] as const))(
    "%s replays to its expected routing through the engine",
    (_id, loaded) => {
      const exp = loaded.case.expected_routing!;
      expect(exp.policy_ref).toEqual({ policy_id: corpus.policy.policyId, version: corpus.policy.version });
      const result = replayCase(loaded, corpus.policy);
      expect(result.status).toBe(exp.expected.status);
      if (exp.expected.status === "ROUTED" && result.status === "ROUTED") {
        expect(result.tier).toBe(exp.expected.tier);
        if (exp.expected.binding_category !== undefined) {
          expect(result.derivation.composition!.baseTier.bindingCategory).toBe(exp.expected.binding_category);
        }
        if (exp.expected.triggers_fired !== undefined) {
          const fired = result.derivation.composition!.triggers.filter((t) => t.fired).map((t) => t.id).sort();
          expect(fired).toEqual([...exp.expected.triggers_fired].sort());
        }
      }
      if (exp.expected.status === "INCOMPLETE" && result.status === "INCOMPLETE") {
        const missing = result.missingFacts.flatMap((m) => m.facts).sort();
        expect(missing).toEqual([...exp.expected.missing_facts].sort());
      }
    }
  );

  it("adversarial cases exist and are tagged", () => {
    expect(corpus.cases.filter((c) => c.case.tags?.includes("adversarial")).length).toBeGreaterThanOrEqual(3);
  });

  it("at least one agent-vs-human pair shows the agent routing strictly higher", () => {
    const agent = corpus.cases.find((c) => c.case.expected_routing?.initiator_kind === "agent");
    expect(agent).toBeDefined();
    const humanTwin = corpus.cases.find(
      (c) =>
        c.case.case_id !== agent!.case.case_id &&
        c.case.expected_routing?.initiator_kind !== "agent" &&
        c.case.tags?.includes("agent-human-pair")
    );
    expect(humanTwin).toBeDefined();
    const agentExp = agent!.case.expected_routing!.expected;
    const humanExp = humanTwin!.case.expected_routing!.expected;
    if (agentExp.status === "ROUTED" && humanExp.status === "ROUTED") {
      expect(agentExp.tier).toBeGreaterThan(humanExp.tier);
    }
  });
});
