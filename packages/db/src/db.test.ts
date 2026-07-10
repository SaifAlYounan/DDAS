import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditEvents,
  classifications,
  documents,
  factSets,
  facts,
  loadOrgSnapshot,
  policies,
  policyVersions,
  principals,
  requests,
  type Db,
} from "./index.js";
import { expectDbReject, freshTestDb, TEST_DATABASE_URL, type TestDb } from "./testing.js";

if (!TEST_DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn("TEST_DATABASE_URL not set — skipping @ddas/db integration suite");
}

describe.skipIf(!TEST_DATABASE_URL)("@ddas/db", () => {
  let t: TestDb;
  let db: Db;
  let adminId: string;

  beforeAll(async () => {
    t = await freshTestDb("db");
    db = t.db;
    const [admin] = await db
      .insert(principals)
      .values({ kind: "human", name: "Admin", email: "admin@example.test" })
      .returning();
    adminId = admin!.id;
  }, 30_000);

  afterAll(async () => {
    await t?.close();
  });

  describe("constraints", () => {
    it("rejects an agent principal without an accountable owner", async () => {
      await expectDbReject(
        db.insert(principals).values({ kind: "agent", name: "rogue-bot" })
      , /principals_agent_has_owner/);
    });

    it("accepts an agent that points at its human owner", async () => {
      const [agent] = await db
        .insert(principals)
        .values({ kind: "agent", name: "procurement-bot", ownerPrincipalId: adminId })
        .returning();
      expect(agent!.ownerPrincipalId).toBe(adminId);
    });
  });

  describe("policy_versions lifecycle", () => {
    let policyId: string;

    async function draftVersion(version: number) {
      const [row] = await db
        .insert(policyVersions)
        .values({
          policyId,
          version,
          sourceYaml: "x: 1",
          canonicalJson: { x: 1 },
          contentHash: `hash-${version}`,
          createdBy: adminId,
        })
        .returning();
      return row!;
    }

    beforeAll(async () => {
      const [p] = await db
        .insert(policies)
        .values({ slug: "test-policy", createdBy: adminId })
        .returning();
      policyId = p!.id;
    });

    it("refuses activation without a simulation run or an override reason", async () => {
      const v = await draftVersion(1);
      await expectDbReject(
        db
          .update(policyVersions)
          .set({ status: "active", activatedAt: new Date() })
          .where(eq(policyVersions.id, v.id))
      , /policy_versions_activation_gate/);
    });

    it("activates with an explicit override reason, then freezes the row", async () => {
      await db
        .update(policyVersions)
        .set({
          status: "active",
          activatedAt: new Date(),
          activationOverrideReason: "initial bootstrap, no history to simulate",
        })
        .where(eq(policyVersions.version, 1));

      await expectDbReject(
        db
          .update(policyVersions)
          .set({ canonicalJson: { x: 2 } })
          .where(eq(policyVersions.version, 1))
      , /frozen/);
    });

    it("enforces one active version per policy", async () => {
      const v2 = await draftVersion(2);
      await expectDbReject(
        db
          .update(policyVersions)
          .set({ status: "active", activationOverrideReason: "second active" })
          .where(eq(policyVersions.id, v2.id))
      , /policy_versions_one_active_uq/);
    });

    it("allows active → retired and nothing else post-draft", async () => {
      await db
        .update(policyVersions)
        .set({ status: "retired", retiredAt: new Date() })
        .where(eq(policyVersions.version, 1));
      const [v] = await db
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.version, 1));
      expect(v!.status).toBe("retired");

      await expectDbReject(
        db
          .update(policyVersions)
          .set({ status: "draft" })
          .where(eq(policyVersions.version, 1))
      , /frozen/);
    });

    it("forbids deleting non-draft versions", async () => {
      await expectDbReject(
        db.delete(policyVersions).where(eq(policyVersions.version, 1))
      , /cannot delete non-draft/);
    });
  });

  describe("fact_sets freeze on confirm", () => {
    let requestId: string;
    let factSetId: string;
    let factRowId: string;

    beforeAll(async () => {
      const [pv] = await db
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.version, 2));
      const [req] = await db
        .insert(requests)
        .values({
          requesterId: adminId,
          policyVersionId: pv!.id,
          title: "Test request",
        })
        .returning();
      requestId = req!.id;
      const [fs] = await db
        .insert(factSets)
        .values({ requestId, version: 1 })
        .returning();
      factSetId = fs!.id;
      const [fact] = await db
        .insert(facts)
        .values({
          factSetId,
          factId: "contract_value",
          status: "FOUND",
          value: 100000,
          citationDocIndex: 0,
          citationStart: 10,
          citationEnd: 20,
          citationText: "EUR 100,000",
        })
        .returning();
      factRowId = fact!.id;
    });

    it("enforces the FOUND-has-citation check", async () => {
      await expectDbReject(
        db
          .insert(facts)
          .values({ factSetId, factId: "bare_found", status: "FOUND", value: 1 })
      , /facts_found_has_citation/);
    });

    it("allows edits while draft, freezes fact_set and facts once confirmed", async () => {
      await db
        .update(facts)
        .set({ value: 120000 })
        .where(eq(facts.id, factRowId));

      await db
        .update(factSets)
        .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: adminId })
        .where(eq(factSets.id, factSetId));

      await expectDbReject(
        db.update(facts).set({ value: 1 }).where(eq(facts.id, factRowId))
      , /confirmed fact_set/);
      await expectDbReject(
        db.delete(facts).where(eq(facts.id, factRowId))
      , /confirmed fact_set/);
      await expectDbReject(
        db
          .update(factSets)
          .set({ promptHash: "tamper" })
          .where(eq(factSets.id, factSetId))
      , /confirmed and frozen/);
      await expectDbReject(
        db.delete(factSets).where(eq(factSets.id, factSetId))
      , /cannot delete confirmed/);
    });

    it("keeps classifications INSERT-only", async () => {
      const [pv] = await db
        .select()
        .from(policyVersions)
        .where(eq(policyVersions.version, 2));
      const [c] = await db
        .insert(classifications)
        .values({
          requestId,
          factSetId,
          policyVersionId: pv!.id,
          engineVersion: "2.0.0",
          status: "ROUTED",
          tier: 2,
          tierName: "CFO",
          derivation: { fake: true },
          derivationHash: "abc",
        })
        .returning();
      await expectDbReject(
        db
          .update(classifications)
          .set({ tier: 0 })
          .where(eq(classifications.id, c!.id))
      , /INSERT-only/);
      await expectDbReject(
        db.delete(classifications).where(eq(classifications.id, c!.id))
      , /INSERT-only/);
    });

    it("enforces one docIndex per request", async () => {
      await db.insert(documents).values({
        requestId,
        docIndex: 0,
        name: "a.txt",
        sha256: "s1",
        contentType: "text/plain",
        sizeBytes: 3,
        extractedText: "abc",
      });
      await expectDbReject(
        db.insert(documents).values({
          requestId,
          docIndex: 0,
          name: "b.txt",
          sha256: "s2",
          contentType: "text/plain",
          sizeBytes: 3,
          extractedText: "def",
        })
      , /documents_request_index_uq/);
    });
  });

  describe("audit_events INSERT-only", () => {
    it("rejects UPDATE and DELETE outright", async () => {
      const [ev] = await db
        .insert(auditEvents)
        .values({
          actor: { kind: "system" },
          type: "test.event",
          entity: { table: "none" },
          payload: {},
          prevHash: "GENESIS",
          eventHash: "h1",
        })
        .returning();
      await expectDbReject(
        db
          .update(auditEvents)
          .set({ payload: { tampered: true } })
          .where(eq(auditEvents.seq, ev!.seq))
      , /INSERT-only/);
      await expectDbReject(
        db.delete(auditEvents).where(eq(auditEvents.seq, ev!.seq))
      , /INSERT-only/);
      // Plain TRUNCATE is already refused by the webhook_deliveries FK;
      // CASCADE gets past the FK and must hit the INSERT-only trigger.
      await expectDbReject(t.pool.query("TRUNCATE audit_events CASCADE"), /INSERT-only/);
    });
  });

  describe("org snapshot loader", () => {
    it("loads units, people, positions, assignments, delegations", async () => {
      // The self-delegation violates delegations_not_self — loader surfaces it.
      await expectDbReject(loadOrgSnapshot(db, {
        units: [
          { key: "root", name: "Kolvarra B.V." },
          { key: "fin", name: "Finance", parent: "root" },
        ],
        people: [
          { key: "ceo", name: "CEO", email: "ceo@kolvarra.test", roles: ["approver"] },
          { key: "bot", name: "buy-bot", kind: "agent", owner: "ceo" },
        ],
        positions: [
          { key: "ceo-pos", unit: "root", title: "Chief Executive", tier: 3, holder: "ceo" },
        ],
        delegations: [
          {
            from: "ceo",
            to: "ceo",
            maxTier: 1,
            validFrom: "2026-01-01T00:00:00Z",
            reason: "self-delegation must be rejected",
          },
        ],
      }), /delegations_not_self/);

      const ok = await loadOrgSnapshot(db, {
        units: [{ key: "ops", name: "Operations" }],
        people: [{ key: "lead", name: "Ops Lead" }],
        positions: [{ key: "lead-pos", unit: "ops", title: "Team Lead", tier: 0, holder: "lead" }],
      });
      expect(ok.unitIds.size).toBe(1);
      expect(ok.positionIds.size).toBe(1);
    });
  });
});
