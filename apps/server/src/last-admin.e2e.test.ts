/**
 * authn-C4: the last-admin guard must serialize concurrent admin removals.
 *
 * Before the fix assertNotLastAdmin did SELECT-then-act at READ COMMITTED with
 * no row lock, so two transactions each removing a DIFFERENT admin both saw the
 * other still present, both passed, and the system dropped to zero admins. The
 * guard now locks every admin role_assignment row FOR UPDATE, so the two
 * transactions serialize and the loser sees only itself left and is refused.
 */
import { freshTestDb, TEST_DATABASE_URL, type TestDb } from "@ddas/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deactivatePrincipal } from "./domain/principals.js";
import { withTx } from "./domain/tx.js";

describe.skipIf(!TEST_DATABASE_URL)("last-admin guard concurrency (authn-C4)", () => {
  let tdb: TestDb;

  beforeAll(async () => {
    tdb = await freshTestDb("last_admin");
  }, 30_000);

  afterAll(async () => {
    await tdb?.close();
  });

  async function seedTwoAdmins(): Promise<[string, string]> {
    return withTx(tdb.pool, async (client) => {
      const ids: string[] = [];
      for (const name of ["Admin A", "Admin B"]) {
        const email = `${name.replace(/\s+/g, "").toLowerCase()}@kolvarra.test`;
        const p = await client.query<{ id: string }>(
          `INSERT INTO principals (kind, name, email) VALUES ('human', $1, $2) RETURNING id`,
          [name, email]
        );
        const id = p.rows[0]!.id;
        await client.query(
          `INSERT INTO role_assignments (principal_id, role) VALUES ($1, 'admin')`,
          [id]
        );
        ids.push(id);
      }
      return [ids[0]!, ids[1]!];
    });
  }

  async function enabledAdminCount(): Promise<number> {
    const r = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM role_assignments r JOIN principals p ON p.id = r.principal_id
        WHERE r.role = 'admin' AND p.disabled_at IS NULL`
    );
    return r.rows[0]!.n;
  }

  it("two concurrent removals cannot drop the system to zero admins — exactly one wins", async () => {
    const [a, b] = await seedTwoAdmins();
    expect(await enabledAdminCount()).toBe(2);

    const actor = { kind: "system" as const };
    // Fire both deactivations in parallel on their own connections/transactions.
    const results = await Promise.allSettled([
      withTx(tdb.pool, (client) => deactivatePrincipal(client, a, actor, "test")),
      withTx(tdb.pool, (client) => deactivatePrincipal(client, b, actor, "test")),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser fails specifically on the last-admin guard, not some other error.
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("last enabled admin");

    // At least one enabled admin survives (in fact exactly one).
    expect(await enabledAdminCount()).toBe(1);
  });
});
