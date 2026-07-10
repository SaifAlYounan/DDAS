/**
 * Request creation, shared by the REST multipart route and the MCP
 * request_authority tool — one pipeline regardless of who (or what) submits.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import type { CompiledPolicy } from "@ddas/policy";
import type pg from "pg";
import type { AppContext } from "../app.js";
import { ApiError } from "../errors.js";
import { bossDb, withTx } from "./tx.js";

export interface SubmittedDoc {
  name: string;
  content: Buffer;
}

const ALLOWED_EXTENSIONS = new Set([".txt", ".md"]);

export function assertSupportedDocument(name: string): void {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ApiError(
      "validation_failed",
      `unsupported document type "${ext}" — Phase 3 accepts .txt and .md`
    );
  }
}

export async function activePolicyVersionId(
  ctx: AppContext,
  policySlug: string
): Promise<string> {
  const active = await ctx.pool.query<{ id: string }>(
    `SELECT v.id FROM policy_versions v JOIN policies p ON p.id = v.policy_id
     WHERE p.slug = $1 AND v.status = 'active'`,
    [policySlug]
  );
  if (!active.rows[0]) {
    throw new ApiError("not_found", `no active policy version for slug "${policySlug}"`);
  }
  return active.rows[0].id;
}

/** Create the request + documents atomically, then enqueue extraction. */
export async function createRequest(
  ctx: AppContext,
  args: {
    requesterId: string;
    policyVersionId: string;
    title: string;
    actionType?: string | undefined;
    documents: SubmittedDoc[];
    actor: AuditActor;
    meta?: Record<string, unknown>;
  }
): Promise<string> {
  if (args.documents.length === 0) {
    throw new ApiError("validation_failed", "at least one document is required");
  }
  for (const doc of args.documents) assertSupportedDocument(doc.name);
  await mkdir(ctx.env.BLOB_DIR, { recursive: true });

  const requestId = await withTx(ctx.pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO requests (requester_id, policy_version_id, title, action_type, state)
       VALUES ($1, $2, $3, $4, 'extracting') RETURNING id`,
      [args.requesterId, args.policyVersionId, args.title, args.actionType ?? null]
    );
    const id = inserted.rows[0]!.id;
    await appendAuditEvent(client, {
      actor: args.actor,
      type: "request.submitted",
      entity: { type: "request", id },
      payload: { title: args.title, documents: args.documents.length, ...(args.meta ?? {}) },
    });

    for (const [docIndex, doc] of args.documents.entries()) {
      const sha256 = createHash("sha256").update(doc.content).digest("hex");
      await writeFile(path.join(ctx.env.BLOB_DIR, sha256), doc.content);
      const documentRow = await client.query<{ id: string }>(
        `INSERT INTO documents (request_id, doc_index, name, sha256, content_type, size_bytes, extracted_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          id,
          docIndex,
          doc.name,
          sha256,
          doc.name.endsWith(".md") ? "text/markdown" : "text/plain",
          doc.content.length,
          doc.content.toString("utf8"),
        ]
      );
      await appendAuditEvent(client, {
        actor: args.actor,
        type: "document.uploaded",
        entity: { type: "document", id: documentRow.rows[0]!.id },
        payload: { requestId: id, name: doc.name, sha256 },
      });
    }
    // Enqueue extraction INSIDE the transaction — the job commits with the
    // request, so a crash right after commit can never leave it stranded in
    // 'extracting' with no job queued.
    if (ctx.boss) {
      await ctx.boss.send(
        "extraction.run",
        { requestId: id },
        { retryLimit: 2, retryDelay: 5, db: bossDb(client) }
      );
    }
    return id;
  });

  ctx.counters.requests.inc();
  return requestId;
}

export type AccessMode = "read" | "write";

/**
 * Multi-tenant confinement for a single request. Access is granted to: the
 * requester who owns it; the accountable HUMAN OWNER when the requester is an
 * agent (so the owner can attest the human-gated facts on the agent's
 * request); an admin (everything); approvers and auditors as trusted
 * reviewers (auditors read-only); viewers read-only (admin-wide read
 * visibility, no writes of any kind). A bare requester can therefore never
 * reach ANOTHER requester's facts, citations, derivation, or state — the hole
 * the MCP ownRequest guard already closed for agents, now closed on the REST
 * side. Returns the owning requester's id.
 */
export async function assertRequestAccess(
  client: pg.ClientBase | pg.Pool,
  requestId: string,
  principal: { id: string; roles: readonly string[] },
  mode: AccessMode
): Promise<string> {
  const row = await client.query<{ requester_id: string; owner_principal_id: string | null }>(
    `SELECT r.requester_id, p.owner_principal_id
     FROM requests r JOIN principals p ON p.id = r.requester_id
     WHERE r.id = $1`,
    [requestId]
  );
  if (!row.rows[0]) throw new ApiError("not_found", `request ${requestId} not found`);
  const requesterId = row.rows[0].requester_id;
  const ok =
    requesterId === principal.id ||
    row.rows[0].owner_principal_id === principal.id ||
    principal.roles.includes("admin") ||
    principal.roles.includes("approver") ||
    (mode === "read" &&
      (principal.roles.includes("auditor") || principal.roles.includes("viewer")));
  if (!ok) throw new ApiError("forbidden", "you do not have access to this request");
  return requesterId;
}

/**
 * Attestation-required facts demand a HUMAN attester — an agent attesting
 * its own gating facts would make the agent appetite gate theater.
 */
export function assertMayAttest(
  policy: CompiledPolicy,
  factId: string,
  principalKind: "human" | "agent"
): void {
  if (principalKind !== "agent") return;
  const attestationIds = new Set(
    policy.compiled.agent.attestationFactIdxs.map(
      (index) => policy.compiled.factTable[index]!.id
    )
  );
  if (attestationIds.has(factId)) {
    throw new ApiError(
      "forbidden",
      `fact "${factId}" requires attestation by the accountable human owner, not an agent`
    );
  }
}
