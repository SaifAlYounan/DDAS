/**
 * Boot-time admin bootstrap: if no enabled human admin exists and the
 * DDAS_ADMIN_* env vars are set, create one. Idempotent; audited.
 */
import argon2 from "argon2";
import { appendAuditEvent } from "@ddas/audit";
import type pg from "pg";
import { withTx } from "./domain/tx.js";
import type { Env } from "./env.js";
import { ARGON2_OPTS } from "./routes/auth.js";

/** Advisory-lock key for first-boot bootstrap (distinct from the audit chain's and @ddas/db's migration key). */
const BOOTSTRAP_LOCK_KEY = 7_474_102;

async function adminExists(q: pg.Pool | pg.PoolClient): Promise<boolean> {
  const existing = await q.query(
    `SELECT 1 FROM role_assignments r
     JOIN principals p ON p.id = r.principal_id
     WHERE r.role = 'admin' AND p.disabled_at IS NULL LIMIT 1`
  );
  return Boolean(existing.rows[0]);
}

export async function bootstrapAdmin(pool: pg.Pool, env: Env): Promise<string | null> {
  if (!env.DDAS_ADMIN_EMAIL || !env.DDAS_ADMIN_PASSWORD) return null;
  // Cheap unlocked fast path — every later boot of an initialized system.
  if (await adminExists(pool)) return null;

  const passwordHash = await argon2.hash(env.DDAS_ADMIN_PASSWORD, ARGON2_OPTS);
  return withTx(pool, async (client) => {
    // Replicas booting simultaneously both pass the fast path on an empty
    // database; the transaction-scoped advisory lock serializes them and the
    // re-check makes the loser a no-op — exactly one admin row, ever.
    await client.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK_KEY]);
    if (await adminExists(client)) return null;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO principals (kind, name, email, password_hash)
       VALUES ('human', 'Administrator', $1, $2) RETURNING id`,
      [env.DDAS_ADMIN_EMAIL, passwordHash]
    );
    const id = inserted.rows[0]!.id;
    for (const role of ["admin", "policy_author", "approver", "requester", "auditor"]) {
      await client.query(
        "INSERT INTO role_assignments (principal_id, role) VALUES ($1, $2)",
        [id, role]
      );
    }
    await client.query(
      `INSERT INTO org_settings (id, sla_hours_by_tier) VALUES (TRUE, '{}')
       ON CONFLICT (id) DO NOTHING`
    );
    await appendAuditEvent(client, {
      actor: { kind: "system" },
      type: "admin.bootstrap",
      entity: { type: "principal", id },
      payload: { email: env.DDAS_ADMIN_EMAIL },
    });
    return id;
  });
}
