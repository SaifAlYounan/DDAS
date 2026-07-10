/**
 * Principal lifecycle shared by the admin API and SCIM provisioning.
 *
 * The principals table is the MUTABLE identity layer (unlike the
 * decision-critical INSERT-only tables): deactivation flips `disabled_at`,
 * and reactivation clears it. Deactivating is immediate and total — the
 * principal's sessions are deleted and its API keys revoked in the same
 * transaction, so no live credential survives the deprovision.
 */
import { appendAuditEvent, type AuditActor } from "@ddas/audit";
import type pg from "pg";
import { ApiError } from "../errors.js";

/**
 * The last-admin guard: refuse any change that would leave the system with
 * no enabled admin (deactivating the last admin, or revoking its admin
 * role). Shared by the admin roles route and every SCIM mutation path.
 */
export async function assertNotLastAdmin(
  client: pg.ClientBase,
  principalId: string,
  action: string
): Promise<void> {
  // Lock EVERY admin row before reading, so two concurrent admin removals
  // serialize here instead of both passing a stale SELECT and dropping the
  // count to zero (authn-C4 TOCTOU). The audit chain's advisory lock is taken
  // lazily inside appendAuditEvent — after this read-then-act — so it cannot
  // serialize the guard. Both callers request the same row set in the same
  // order, so this blocks cleanly (no deadlock): the loser re-reads the
  // committed state and sees only itself left.
  //
  // Lock BOTH tables (FOR UPDATE OF r, p): the two mutation paths touch
  // different rows — role-revoke DELETEs role_assignments (r), deactivate
  // UPDATEs principals.disabled_at (p) — and READ COMMITTED only re-reads a
  // concurrently-modified row on unblock if THIS query locked it. Locking r
  // alone let a parallel deactivate's disabled_at stay stale on reread.
  const admins = await client.query<{ principal_id: string; disabled_at: Date | null }>(
    `SELECT r.principal_id, p.disabled_at
       FROM role_assignments r
       JOIN principals p ON p.id = r.principal_id
      WHERE r.role = 'admin'
      ORDER BY r.principal_id
      FOR UPDATE OF r, p`
  );
  const targetIsAdmin = admins.rows.some((a) => a.principal_id === principalId);
  if (!targetIsAdmin) return; // not an admin — nothing to guard
  const anotherEnabledAdmin = admins.rows.some(
    (a) => a.principal_id !== principalId && a.disabled_at === null
  );
  if (!anotherEnabledAdmin) {
    throw new ApiError("conflict", `cannot ${action} the last enabled admin`);
  }
}

/**
 * Deactivate a principal and kill every live credential it holds:
 * sessions are deleted, API keys revoked — all in the caller's transaction.
 * Idempotent (deactivating an already-disabled principal is a no-op).
 */
export async function deactivatePrincipal(
  client: pg.ClientBase,
  principalId: string,
  actor: AuditActor,
  via: string
): Promise<void> {
  await assertNotLastAdmin(client, principalId, "deactivate");
  const updated = await client.query(
    "UPDATE principals SET disabled_at = now() WHERE id = $1 AND disabled_at IS NULL",
    [principalId]
  );
  if (updated.rowCount === 0) return; // already disabled
  const sessions = await client.query("DELETE FROM sessions WHERE principal_id = $1", [
    principalId,
  ]);
  const keys = await client.query(
    "UPDATE api_keys SET revoked_at = now() WHERE principal_id = $1 AND revoked_at IS NULL",
    [principalId]
  );
  await appendAuditEvent(client, {
    actor,
    type: "principal.disabled",
    entity: { type: "principal", id: principalId },
    payload: {
      via,
      sessionsKilled: sessions.rowCount ?? 0,
      apiKeysRevoked: keys.rowCount ?? 0,
    },
  });
}

/** Clear `disabled_at`. Sessions and API keys stay dead — only new logins work. */
export async function reactivatePrincipal(
  client: pg.ClientBase,
  principalId: string,
  actor: AuditActor,
  via: string
): Promise<void> {
  const updated = await client.query(
    "UPDATE principals SET disabled_at = NULL WHERE id = $1 AND disabled_at IS NOT NULL",
    [principalId]
  );
  if (updated.rowCount === 0) return; // already enabled
  await appendAuditEvent(client, {
    actor,
    type: "principal.enabled",
    entity: { type: "principal", id: principalId },
    payload: { via },
  });
}
