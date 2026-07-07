/**
 * Phase 1 storage: a content-addressed directory of canonical JSON files
 * (default ./.ddas, override with --data-dir or DDAS_DATA_DIR).
 *
 * Every artifact here is an immutable, hashed JSON document — a directory IS
 * the honest store: git-diffable, auditable offline, zero daemons. The layout
 * is designed as Phase 2's Postgres import/seed format.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  canonicalBytes,
  compileDocument,
  type CompiledPolicy,
  type RiskPolicyV1,
} from "@ddas/policy";
import type { ClassificationResult, FactSet, Subject } from "@ddas/engine";

export interface SubmissionManifest {
  id: string;
  subject: Subject;
  documents: Array<{ name: string; sha256: string }>;
  createdAt: string;
}

export class Store {
  constructor(public readonly root: string) {}

  private ensure(dir: string): string {
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ---------- policies ----------

  registerPolicy(policy: CompiledPolicy): { path: string; alreadyRegistered: boolean } {
    const dir = this.ensure(join(this.root, "policies", policy.policyId));
    const path = join(dir, `${policy.version}.json`);
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8");
      if (existing !== canonicalBytes(policy.document)) {
        throw new Error(
          `policy ${policy.policyId}@${policy.version} is already registered with different content — versions are immutable, bump the version`
        );
      }
      return { path, alreadyRegistered: true };
    }
    writeFileSync(path, canonicalBytes(policy.document));
    writeFileSync(
      join(dir, `${policy.version}.meta.json`),
      JSON.stringify({ contentHash: policy.contentHash, registeredAt: new Date().toISOString() }, null, 2) + "\n"
    );
    return { path, alreadyRegistered: false };
  }

  loadPolicy(ref: string): CompiledPolicy {
    const { id, version } = this.parseRef(ref);
    const path = join(this.root, "policies", id, `${version}.json`);
    if (!existsSync(path)) throw new Error(`policy ${id}@${version} is not registered`);
    return compileDocument(JSON.parse(readFileSync(path, "utf8")) as RiskPolicyV1);
  }

  activatePolicy(ref: string): void {
    this.loadPolicy(ref); // must exist
    writeFileSync(join(this.ensure(join(this.root, "policies")), "ACTIVE"), ref + "\n");
  }

  activeRef(): string | null {
    const path = join(this.root, "policies", "ACTIVE");
    return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
  }

  listPolicies(): Array<{ id: string; version: number; contentHash: string; active: boolean }> {
    const dir = join(this.root, "policies");
    if (!existsSync(dir)) return [];
    const active = this.activeRef();
    const out: Array<{ id: string; version: number; contentHash: string; active: boolean }> = [];
    for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      for (const f of readdirSync(join(dir, id)).filter((f) => f.endsWith(".meta.json"))) {
        const version = Number(f.replace(".meta.json", ""));
        const meta = JSON.parse(readFileSync(join(dir, id, f), "utf8"));
        out.push({ id, version, contentHash: meta.contentHash, active: active === `${id}@${version}` });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  }

  parseRef(ref: string): { id: string; version: number } {
    const m = /^([a-z0-9][a-z0-9-]*)@(\d+)$/.exec(ref);
    if (!m) throw new Error(`policy reference must be <policy_id>@<version>, got '${ref}'`);
    return { id: m[1]!, version: Number(m[2]) };
  }

  // ---------- submissions ----------

  createSubmission(docPaths: string[], subject: Subject): SubmissionManifest {
    const subsDir = this.ensure(join(this.root, "submissions"));
    const n = readdirSync(subsDir).filter((d) => d.startsWith("sub-")).length + 1;
    const id = `sub-${String(n).padStart(4, "0")}`;
    const dir = this.ensure(join(subsDir, id));
    const docsDir = this.ensure(join(dir, "docs"));
    const documents = docPaths.map((p) => {
      const name = basename(p);
      copyFileSync(p, join(docsDir, name));
      const text = readFileSync(join(docsDir, name), "utf8");
      return { name, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
    });
    const manifest: SubmissionManifest = { id, subject, documents, createdAt: new Date().toISOString() };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  }

  writeFactSet(submissionId: string, factSet: FactSet): void {
    writeFileSync(
      join(this.root, "submissions", submissionId, "factset.json"),
      JSON.stringify(factSet, null, 2) + "\n"
    );
  }

  loadManifest(submissionId: string): SubmissionManifest {
    return JSON.parse(readFileSync(join(this.root, "submissions", submissionId, "manifest.json"), "utf8"));
  }

  loadFactSet(submissionId: string): FactSet {
    const path = join(this.root, "submissions", submissionId, "factset.json");
    if (!existsSync(path)) throw new Error(`submission ${submissionId} has no fact set yet`);
    return JSON.parse(readFileSync(path, "utf8"));
  }

  listSubmissions(): string[] {
    const dir = join(this.root, "submissions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((d) => d.startsWith("sub-")).sort();
  }

  docText(submissionId: string, name: string): string {
    return readFileSync(join(this.root, "submissions", submissionId, "docs", name), "utf8");
  }

  // ---------- classifications ----------

  writeClassification(submissionId: string, result: ClassificationResult): string {
    const dir = this.ensure(join(this.root, "classifications", submissionId));
    const seq = readdirSync(dir).length + 1;
    const path = join(dir, `${String(seq).padStart(3, "0")}.derivation.json`);
    writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
    return path;
  }

  // ---------- reports ----------

  writeSimulationReport(name: string, report: unknown): string {
    const dir = this.ensure(join(this.root, "reports", "simulations"));
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    return path;
  }

  hasSimulationReportFor(draftHash8: string): boolean {
    const dir = join(this.root, "reports", "simulations");
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.startsWith(draftHash8));
  }
}

export function openStore(dataDir?: string): Store {
  return new Store(dataDir ?? process.env["DDAS_DATA_DIR"] ?? join(process.cwd(), ".ddas"));
}
