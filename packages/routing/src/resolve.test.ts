import { describe, expect, it } from "vitest";
import { decideTask } from "./decide.js";
import { resolveApprovers, resolveEscalation, type OrgView } from "./resolve.js";

/**
 * Fixture org:
 *   root (Kolvarra B.V.)
 *   ├─ finance          — CFO position (tier 3, held by cfo)
 *   │   └─ procurement  — Procurement Lead (tier 1, held by lead),
 *   │                     Procurement Director (tier 2, VACANT since March)
 *   └─ board            — 5 board seats (tier 4)
 */
const ASOF = "2026-07-08T12:00:00.000Z";
const EPOCH = "2020-01-01T00:00:00.000Z";

function fixtureOrg(): OrgView {
  return {
    units: [
      { id: "root", parentId: null },
      { id: "finance", parentId: "root" },
      { id: "procurement", parentId: "finance" },
      { id: "board", parentId: "root" },
    ],
    positions: [
      { id: "pos-lead", orgUnitId: "procurement", authorityTier: 1 },
      { id: "pos-dir", orgUnitId: "procurement", authorityTier: 2 },
      { id: "pos-cfo", orgUnitId: "finance", authorityTier: 3 },
      { id: "pos-ceo", orgUnitId: "root", authorityTier: 3 },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `pos-board-${i}`,
        orgUnitId: "root",
        authorityTier: 4,
      })),
    ],
    assignments: [
      { id: "asg-lead", positionId: "pos-lead", principalId: "lead", validFrom: EPOCH, validTo: null },
      // Director seat vacated in March — temporal validity IS the absence model.
      { id: "asg-dir-old", positionId: "pos-dir", principalId: "old-director", validFrom: EPOCH, validTo: "2026-03-01T00:00:00.000Z" },
      { id: "asg-cfo", positionId: "pos-cfo", principalId: "cfo", validFrom: EPOCH, validTo: null },
      { id: "asg-ceo", positionId: "pos-ceo", principalId: "ceo", validFrom: EPOCH, validTo: null },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `asg-board-${i}`,
        positionId: `pos-board-${i}`,
        principalId: `board-${i}`,
        validFrom: EPOCH,
        validTo: null,
      })),
    ],
    delegations: [],
  };
}

const baseRequest = {
  requesterId: "requester",
  requesterUnitId: "procurement",
  asOf: ASOF,
} as const;

describe("resolveApprovers", () => {
  it("routes tier 1 to the requester's own unit lead", () => {
    const result = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvers).toEqual([
      { principalId: "lead", via: "position", sourceId: "asg-lead", unitId: "procurement", tier: 1 },
    ]);
    expect(result.quorum).toBe(1);
    expect(result.trace.outcome).toBe("resolved");
  });

  it("skips the vacant director seat and walks up to the CFO for tier 2", () => {
    const result = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvers.map((a) => a.principalId)).toEqual(["cfo"]);
    const procurementStep = result.trace.ladder.find((s) => s.unitId === "procurement");
    expect(procurementStep?.vacantPositions).toEqual(["pos-dir"]);
  });

  it("still finds the director when asked as-of before the vacancy (audit replay)", () => {
    const result = resolveApprovers(fixtureOrg(), {
      ...baseRequest,
      requiredTier: 2,
      asOf: "2026-02-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvers.map((a) => a.principalId)).toEqual(["old-director"]);
  });

  it("excludes the requester and widens up the ladder past the exclusion", () => {
    // lead is the only tier-1 holder in procurement; as the requester they
    // are excluded, so the walk widens to finance and lands on the CFO.
    const asLead = resolveApprovers(fixtureOrg(), {
      ...baseRequest,
      requesterId: "lead",
      requiredTier: 1,
    });
    expect(asLead.ok).toBe(true);
    if (!asLead.ok) return;
    expect(asLead.trace.requesterExcluded).toBe(true);
    expect(asLead.approvers.map((a) => a.principalId)).toEqual(["cfo"]);

    const selfApprove = resolveApprovers(fixtureOrg(), {
      ...baseRequest,
      requesterId: "lead",
      requiredTier: 1,
      allowSelfApprove: true,
    });
    expect(selfApprove.ok).toBe(true);
    if (!selfApprove.ok) return;
    expect(selfApprove.approvers.map((a) => a.principalId)).toEqual(["lead"]);
  });

  it("computes majority quorum over the eligible set", () => {
    const result = resolveApprovers(fixtureOrg(), {
      ...baseRequest,
      requiredTier: 4,
      quorum: "majority",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvers).toHaveLength(5);
    expect(result.quorum).toBe(3);
  });

  it("widens for an integer quorum and fails typed when the ladder is exhausted", () => {
    // Tier 3, quorum 2: finance yields only the CFO, so the walk widens to
    // root — which contributes EVERY live holder at tier >= 3 there (CEO +
    // all five board seats). Widening is per-unit, not per-person.
    const two = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 3, quorum: 2 });
    expect(two.ok).toBe(true);
    if (two.ok) {
      const ids = two.approvers.map((a) => a.principalId);
      expect(ids).toContain("cfo");
      expect(ids).toContain("ceo");
      expect(ids).toHaveLength(7);
    }

    // Quorum 8 exceeds every tier>=3 holder in the company (7) → typed failure.
    const impossible = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 3, quorum: 8 });
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) expect(impossible.failure).toBe("quorum_unreachable");
  });

  it("fails typed with no_eligible_approvers when nobody holds the tier", () => {
    const result = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 9 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe("no_eligible_approvers");
    expect(result.trace.ladder.length).toBeGreaterThan(0);
  });

  describe("delegations", () => {
    function withDelegation(d: Partial<OrgView["delegations"][number]>): OrgView {
      const org = fixtureOrg();
      org.delegations.push({
        id: "del-1",
        fromPrincipalId: "cfo",
        toPrincipalId: "deputy",
        maxTier: 3,
        orgUnitScopeId: null,
        validFrom: EPOCH,
        validTo: null,
        ...d,
      });
      return org;
    }

    it("admits a live, in-ceiling delegation one hop from an eligible delegator", () => {
      const result = resolveApprovers(withDelegation({}), { ...baseRequest, requiredTier: 3, quorum: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const deputy = result.approvers.find((a) => a.principalId === "deputy");
      expect(deputy).toMatchObject({ via: "delegation", sourceId: "del-1" });
    });

    it("rejects a delegation whose ceiling is below the required tier", () => {
      const result = resolveApprovers(withDelegation({ maxTier: 2 }), {
        ...baseRequest,
        requiredTier: 3,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.approvers.map((a) => a.principalId)).not.toContain("deputy");
      const outcome = result.trace.delegations.find((d) => d.delegationId === "del-1");
      expect(outcome).toMatchObject({ admitted: false });
      expect(outcome?.reason).toMatch(/ceiling/);
    });

    it("rejects a delegation scoped to a subtree the requester is outside of", () => {
      const result = resolveApprovers(withDelegation({ orgUnitScopeId: "board" }), {
        ...baseRequest,
        requiredTier: 3,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.approvers.map((a) => a.principalId)).not.toContain("deputy");
    });

    it("accepts a delegation scoped to an ancestor of the requester's unit", () => {
      const result = resolveApprovers(withDelegation({ orgUnitScopeId: "finance" }), {
        ...baseRequest,
        requiredTier: 3,
        quorum: 2,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.approvers.map((a) => a.principalId)).toContain("deputy");
    });

    it("rejects an expired delegation", () => {
      const result = resolveApprovers(
        withDelegation({ validTo: "2026-01-01T00:00:00.000Z" }),
        { ...baseRequest, requiredTier: 3 }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.approvers.map((a) => a.principalId)).not.toContain("deputy");
    });

    it("never chains delegations (one hop only)", () => {
      const org = withDelegation({});
      // deputy re-delegates to sub-deputy — must NOT be admitted.
      org.delegations.push({
        id: "del-2",
        fromPrincipalId: "deputy",
        toPrincipalId: "sub-deputy",
        maxTier: 3,
        orgUnitScopeId: null,
        validFrom: EPOCH,
        validTo: null,
      });
      const result = resolveApprovers(org, { ...baseRequest, requiredTier: 3, quorum: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.approvers.map((a) => a.principalId)).not.toContain("sub-deputy");
    });
  });

  it("is deterministic: same input, same output, sorted approvers", () => {
    const a = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 4, quorum: "majority" });
    const b = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 4, quorum: "majority" });
    expect(a).toEqual(b);
  });
});

describe("resolveEscalation", () => {
  it("adds only new approvers, marked via=escalation", () => {
    const base = resolveApprovers(fixtureOrg(), { ...baseRequest, requiredTier: 2 });
    expect(base.ok).toBe(true);
    const existing = base.ok ? base.approvers.map((a) => a.principalId) : [];

    // Level 1 (tier 3) still resolves to the CFO alone — nothing to add;
    // the server keeps raising the level until someone new appears.
    const levelOne = resolveEscalation(fixtureOrg(), { ...baseRequest, requiredTier: 2 }, 1, existing);
    expect(levelOne.added).toHaveLength(0);

    // Level 2 (tier 4) reaches the board.
    const { added } = resolveEscalation(
      fixtureOrg(),
      { ...baseRequest, requiredTier: 2 },
      2,
      existing
    );
    expect(added.length).toBeGreaterThan(0);
    for (const approver of added) {
      expect(approver.via).toBe("escalation");
      expect(existing).not.toContain(approver.principalId);
    }
  });
});

describe("decideTask", () => {
  it("deny wins immediately", () => {
    expect(
      decideTask([{ action: "approve" }, { action: "reject" }, { action: "approve" }], 2)
    ).toBe("rejected");
  });
  it("approvals accumulate to the frozen quorum", () => {
    expect(decideTask([{ action: "approve" }], 2)).toBe("pending");
    expect(decideTask([{ action: "approve" }, { action: "approve" }], 2)).toBe("approved");
  });
});
