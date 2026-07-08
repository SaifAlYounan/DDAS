/**
 * The DDAS routing resolver.
 *
 * PURITY CONTRACT — same law as the engine: a pure function of its inputs.
 * The org structure and the as-of instant arrive as data; the resolver does
 * comparisons, tree walks, and counting. Same (org, request) → same result,
 * so as-of audit replay of any historical routing is a function call.
 *
 * Semantics (see the platform plan):
 *  - Temporal filter: an assignment/delegation is live iff validFrom <= asOf < validTo.
 *    A position with no live assignment is VACANT and is skipped — temporal
 *    validity IS the absence model.
 *  - Ladder walk: from the requester's unit upward; every unit contributes its
 *    live assignees at tier >= required. The walk stops as soon as quorum is
 *    reachable; if not, it widens up the ladder until the root is exhausted.
 *  - Delegations: ONE hop only, never transitive. A delegation admits the
 *    delegate iff the delegator is position-eligible, the delegation is live,
 *    its maxTier ceiling covers the required tier, and its subtree scope (if
 *    any) contains the requester's unit.
 *  - The requester is excluded unless self-approval is explicitly allowed.
 *  - Quorum: an integer, or "majority" = floor(n/2)+1 over the eligible set.
 *  - Failure is TYPED, never silent: no_eligible_approvers | quorum_unreachable.
 */

export interface OrgView {
  units: Array<{ id: string; parentId: string | null }>;
  positions: Array<{ id: string; orgUnitId: string; authorityTier: number }>;
  assignments: Array<{
    id: string;
    positionId: string;
    principalId: string;
    validFrom: string;
    validTo: string | null;
  }>;
  delegations: Array<{
    id: string;
    fromPrincipalId: string;
    toPrincipalId: string;
    maxTier: number;
    orgUnitScopeId: string | null;
    validFrom: string;
    validTo: string | null;
  }>;
}

export interface ResolveRequest {
  requesterId: string;
  /** The org unit the request originates from (the requester's unit). */
  requesterUnitId: string;
  requiredTier: number;
  /** From the policy's authority ladder for this tier. Default 1. */
  quorum?: number | "majority";
  /** ISO instant the resolution is valid at — enables as-of audit replay. */
  asOf: string;
  allowSelfApprove?: boolean;
}

export interface EligibleApprover {
  principalId: string;
  via: "position" | "delegation" | "escalation";
  /** position_assignments.id | delegations.id | null (escalation). */
  sourceId: string | null;
  /** The unit whose ladder step admitted this approver. */
  unitId: string;
  tier: number;
}

export interface LadderStep {
  unitId: string;
  eligible: Array<{ principalId: string; assignmentId: string; tier: number }>;
  vacantPositions: string[];
}

export interface DelegationOutcome {
  delegationId: string;
  from: string;
  to: string;
  admitted: boolean;
  reason: string;
}

export interface ResolutionTrace {
  asOf: string;
  requiredTier: number;
  quorumRule: number | "majority";
  ladder: LadderStep[];
  delegations: DelegationOutcome[];
  requesterExcluded: boolean;
  quorum: number;
  outcome: "resolved" | "no_eligible_approvers" | "quorum_unreachable";
}

export type ResolutionResult =
  | { ok: true; approvers: EligibleApprover[]; quorum: number; trace: ResolutionTrace }
  | {
      ok: false;
      failure: "no_eligible_approvers" | "quorum_unreachable";
      trace: ResolutionTrace;
    };

function isLive(window: { validFrom: string; validTo: string | null }, asOf: string): boolean {
  return window.validFrom <= asOf && (window.validTo === null || asOf < window.validTo);
}

/** unit id → its chain of ancestors (self first). Cycles are cut, not looped. */
function ancestorChain(org: OrgView, unitId: string): string[] {
  const parents = new Map(org.units.map((u) => [u.id, u.parentId]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = unitId;
  while (cursor !== null && !seen.has(cursor) && parents.has(cursor)) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain;
}

function inSubtree(org: OrgView, unitId: string, rootId: string): boolean {
  return ancestorChain(org, unitId).includes(rootId);
}

function requiredCount(quorumRule: number | "majority", eligibleCount: number): number {
  if (quorumRule === "majority") return Math.floor(eligibleCount / 2) + 1;
  return quorumRule;
}

export function resolveApprovers(org: OrgView, request: ResolveRequest): ResolutionResult {
  const quorumRule = request.quorum ?? 1;
  const chain = ancestorChain(org, request.requesterUnitId);

  const positionsByUnit = new Map<string, OrgView["positions"]>();
  for (const position of org.positions) {
    const list = positionsByUnit.get(position.orgUnitId) ?? [];
    list.push(position);
    positionsByUnit.set(position.orgUnitId, list);
  }
  const assignmentsByPosition = new Map<string, OrgView["assignments"]>();
  for (const assignment of org.assignments) {
    const list = assignmentsByPosition.get(assignment.positionId) ?? [];
    list.push(assignment);
    assignmentsByPosition.set(assignment.positionId, list);
  }

  const ladder: LadderStep[] = [];
  const delegationOutcomes: DelegationOutcome[] = [];
  // principalId → approver (first admission wins; position beats delegation
  // because delegations are only evaluated after their delegator is admitted).
  const admitted = new Map<string, EligibleApprover>();
  let requesterExcluded = false;

  const admit = (approver: EligibleApprover): void => {
    if (approver.principalId === request.requesterId && !request.allowSelfApprove) {
      requesterExcluded = true;
      return;
    }
    if (!admitted.has(approver.principalId)) {
      admitted.set(approver.principalId, approver);
    }
  };

  const evaluateDelegationsFrom = (delegator: EligibleApprover): void => {
    for (const delegation of org.delegations) {
      if (delegation.fromPrincipalId !== delegator.principalId) continue;
      let reason: string;
      let ok = false;
      if (!isLive(delegation, request.asOf)) {
        reason = "not live at asOf";
      } else if (delegation.maxTier < request.requiredTier) {
        reason = `ceiling maxTier=${delegation.maxTier} below required tier ${request.requiredTier}`;
      } else if (
        delegation.orgUnitScopeId !== null &&
        !inSubtree(org, request.requesterUnitId, delegation.orgUnitScopeId)
      ) {
        reason = "requester unit outside delegation scope subtree";
      } else if (delegator.via === "delegation") {
        // Structurally unreachable (we only evaluate from position-admitted
        // principals) — kept as an explicit guard for the one-hop law.
        reason = "transitive delegation chains are forbidden";
      } else {
        ok = true;
        reason = "admitted";
      }
      delegationOutcomes.push({
        delegationId: delegation.id,
        from: delegation.fromPrincipalId,
        to: delegation.toPrincipalId,
        admitted: ok,
        reason,
      });
      if (ok) {
        admit({
          principalId: delegation.toPrincipalId,
          via: "delegation",
          sourceId: delegation.id,
          unitId: delegator.unitId,
          tier: request.requiredTier,
        });
      }
    }
  };

  const quorumReached = (): { quorum: number; reached: boolean } => {
    const quorum = requiredCount(quorumRule, admitted.size);
    return { quorum, reached: admitted.size >= quorum && admitted.size > 0 };
  };

  for (const unitId of chain) {
    const step: LadderStep = { unitId, eligible: [], vacantPositions: [] };
    for (const position of positionsByUnit.get(unitId) ?? []) {
      if (position.authorityTier < request.requiredTier) continue;
      const live = (assignmentsByPosition.get(position.id) ?? []).filter((a) =>
        isLive(a, request.asOf)
      );
      if (live.length === 0) {
        step.vacantPositions.push(position.id);
        continue;
      }
      for (const assignment of live) {
        step.eligible.push({
          principalId: assignment.principalId,
          assignmentId: assignment.id,
          tier: position.authorityTier,
        });
      }
    }
    ladder.push(step);

    const before = admitted.size;
    for (const e of step.eligible) {
      admit({
        principalId: e.principalId,
        via: "position",
        sourceId: e.assignmentId,
        unitId,
        tier: e.tier,
      });
    }
    // One delegation hop from every newly position-admitted principal.
    if (admitted.size > before) {
      for (const approver of [...admitted.values()]) {
        if (approver.via === "position") evaluateDelegationsFrom(approver);
      }
    }

    const { reached } = quorumReached();
    if (reached) break; // widen no further than needed
  }

  const { quorum, reached } = quorumReached();
  const approvers = [...admitted.values()].sort((a, b) =>
    a.principalId < b.principalId ? -1 : a.principalId > b.principalId ? 1 : 0
  );
  const trace: ResolutionTrace = {
    asOf: request.asOf,
    requiredTier: request.requiredTier,
    quorumRule,
    ladder,
    delegations: dedupeOutcomes(delegationOutcomes),
    requesterExcluded,
    quorum,
    outcome: reached
      ? "resolved"
      : admitted.size === 0
        ? "no_eligible_approvers"
        : "quorum_unreachable",
  };

  if (!reached) {
    return {
      ok: false,
      failure: admitted.size === 0 ? "no_eligible_approvers" : "quorum_unreachable",
      trace,
    };
  }
  return { ok: true, approvers, quorum, trace };
}

/** The same delegation can be evaluated at several ladder steps — keep the last verdict per id. */
function dedupeOutcomes(outcomes: DelegationOutcome[]): DelegationOutcome[] {
  const byId = new Map<string, DelegationOutcome>();
  for (const outcome of outcomes) byId.set(outcome.delegationId, outcome);
  return [...byId.values()];
}

/**
 * SLA escalation: re-resolve at requiredTier + level and return only the
 * approvers NOT already on the task, marked via="escalation". Original
 * approvers stay eligible; escalation only ever ADDS.
 */
export function resolveEscalation(
  org: OrgView,
  request: ResolveRequest,
  level: number,
  existingApproverIds: readonly string[]
): { added: EligibleApprover[]; result: ResolutionResult } {
  const result = resolveApprovers(org, {
    ...request,
    requiredTier: request.requiredTier + level,
  });
  const existing = new Set(existingApproverIds);
  const added = (result.ok ? result.approvers : [])
    .filter((a) => !existing.has(a.principalId))
    .map((a) => ({ ...a, via: "escalation" as const, sourceId: null }));
  return { added, result };
}
