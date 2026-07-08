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

export async function bootstrapAdmin(pool: pg.Pool, env: Env): Promise<string | null> {
  if (!env.DDAS_ADMIN_EMAIL || !env.DDAS_ADMIN_PASSWORD) return null;
  const existing = await pool.query(
    `SELECT 1 FROM role_assignments r
     JOIN principals p ON p.id = r.principal_id
     WHERE r.role = 'admin' AND p.disabled_at IS NULL LIMIT 1`
  );
  if (existing.rows[0]) return null;

  const passwordHash = await argon2.hash(env.DDAS_ADMIN_PASSWORD, ARGON2_OPTS);
  return withTx(pool, async (client) => {
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
