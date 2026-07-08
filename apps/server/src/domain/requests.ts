/**
 * Request creation, shared by the REST multipart route and the MCP
 * request_authority tool — one pipeline regardless of who (or what) submits.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import type { CompiledPolicy } from "@ddas/policy";
import type { AppContext } from "../app.js";
import { ApiError } from "../errors.js";
import { withTx } from "./tx.js";

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
    return id;
  });

  if (ctx.boss) {
    await ctx.boss.send("extraction.run", { requestId }, { retryLimit: 2, retryDelay: 5 });
  }
  return requestId;
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
