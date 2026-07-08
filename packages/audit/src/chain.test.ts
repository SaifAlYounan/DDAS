import { freshTestDb, TEST_DATABASE_URL, type TestDb } from "@ddas/db/testing";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  exportCheckpoint,
  verifyChain,
  verifyCheckpoint,
  type Checkpoint,
} from "./index.js";

if (!TEST_DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("TEST_DATABASE_URL not set — skipping @ddas/audit integration suite");
}

async function inTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!TEST_DATABASE_URL)("@ddas/audit", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await freshTestDb();
  }, 30_000);

  afterAll(async () => {
    await t?.close();
  });

  it("appends a linked chain and verifies clean", async () => {
    for (let i = 1; i <= 5; i++) {
      const appended = await inTx(t.pool, (c) =>
        appendAuditEvent(c, {
          actor: { kind: "system" },
          type: "request.state_changed",
          entity: { type: "request", id: `req-${i}` },
          payload: { from: "extracting", to: "facts_review", i },
        })
      );
      expect(appended.seq).toBe(i);
    }

    const result = await inTx(t.pool, (c) => verifyChain(c, { batchSize: 2 }));
    expect(result).toMatchObject({ ok: true, checked: 5 });
  });

  it("rolls back the event together with the caller's transaction", async () => {
    await expect(
      inTx(t.pool, async (c) => {
        await appendAuditEvent(c, {
          actor: { kind: "system" },
          type: "request.failed",
          entity: { type: "request", id: "doomed" },
          payload: {},
        });
        throw new Error("business mutation failed");
      })
    ).rejects.toThrow(/business mutation failed/);

    const result = await inTx(t.pool, (c) => verifyChain(c));
    expect(result).toMatchObject({ ok: true, checked: 5 });
  });

  it("serializes concurrent appends into a contiguous chain", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        inTx(t.pool, (c) =>
          appendAuditEvent(c, {
            actor: { kind: "principal", id: `p-${i}` },
            type: "session.login",
            entity: { type: "session", id: `s-${i}` },
            payload: {},
          })
        )
      )
    );
    const result = await inTx(t.pool, (c) => verifyChain(c));
    expect(result).toMatchObject({ ok: true, checked: 15 });
  });

  describe("tamper detection", () => {
    let checkpoint: Checkpoint;

    it("exports a checkpoint of the head", async () => {
      const cp = await inTx(t.pool, (c) => exportCheckpoint(c));
      expect(cp).not.toBeNull();
      checkpoint = cp!;
      expect(checkpoint.seq).toBe(15);
      expect(await inTx(t.pool, (c) => verifyCheckpoint(c, checkpoint))).toEqual({ ok: true });
    });

    it("pinpoints a rewritten row even when a superuser bypasses the trigger", async () => {
      // Simulate the strongest adversary: disable the INSERT-only trigger and
      // rewrite a payload in place.
      await t.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_insert_only");
      await t.pool.query(
        `UPDATE audit_events SET payload = '{"tampered": true}'::jsonb WHERE seq = 3`
      );
      await t.pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_insert_only");

      const result = await inTx(t.pool, (c) => verifyChain(c));
      expect(result).toMatchObject({ ok: false, firstBadSeq: 3 });
    });

    it("detects a fully-rewritten chain via the external checkpoint", async () => {
      // Adversary rewrites seq 3 AND recomputes all downstream hashes.
      await t.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_insert_only");
      const { hashEnvelope, GENESIS_HASH } = await import("./chain.js");
      const rows = await t.pool.query(
        "SELECT seq, occurred_at, actor, type, entity, payload, prev_hash FROM audit_events ORDER BY seq"
      );
      let prevHash = GENESIS_HASH;
      for (const row of rows.rows) {
        const eventHash = hashEnvelope({
          seq: Number(row.seq),
          occurredAt: row.occurred_at.toISOString(),
          actor: row.actor,
          type: row.type,
          entity: row.entity,
          payload: row.payload,
          prevHash,
        });
        await t.pool.query(
          "UPDATE audit_events SET prev_hash = $1, event_hash = $2 WHERE seq = $3",
          [prevHash, eventHash, row.seq]
        );
        prevHash = eventHash;
      }
      await t.pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_insert_only");

      // The internal walk now passes — the rewrite was self-consistent…
      const walk = await inTx(t.pool, (c) => verifyChain(c));
      expect(walk.ok).toBe(true);
      // …but the checkpoint exported before the rewrite catches it.
      const cp = await inTx(t.pool, (c) => verifyCheckpoint(c, checkpoint));
      expect(cp.ok).toBe(false);
      expect(cp.reason).toMatch(/rewritten/);
    });
  });
});
