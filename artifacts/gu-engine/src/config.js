// Default configuration for the GU Engine
// GC can modify all parameters through the Config Panel

export const DEFAULT_CONFIG = {
  // === WEIGHT PROFILES ===
  // Each profile defines how much each dimension contributes to GU
  // All weights in a profile must sum to 1.0
  profiles: {
    default: {
      label: 'Balanced',
      weights: { financial: 0.25, reversibility: 0.20, regulatory: 0.20, reputational: 0.15, precedent: 0.10, complexity: 0.10 },
    },
    regulated: {
      label: 'Heavily Regulated',
      weights: { financial: 0.15, reversibility: 0.10, regulatory: 0.40, reputational: 0.25, precedent: 0.05, complexity: 0.05 },
    },
    startup: {
      label: 'Growth / Startup',
      weights: { financial: 0.35, reversibility: 0.15, regulatory: 0.03, reputational: 0.07, precedent: 0.15, complexity: 0.25 },
    },
    publicCo: {
      label: 'Public Company',
      weights: { financial: 0.15, reversibility: 0.10, regulatory: 0.30, reputational: 0.35, precedent: 0.03, complexity: 0.07 },
    },
  },

  // === APPROVAL TIERS ===
  // GU thresholds that map to approval authority
  tiers: [
    { name: 'Self-Approve', maxGU: 15, approver: 'Individual (log only)', sla: 'Instant', controls: 'Post-hoc audit sampling', signatures: '1 signature (self-certified, logged)', color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
    { name: 'Manager', maxGU: 30, approver: 'Direct manager', sla: '24 hours', controls: 'Manager review + documentation', signatures: '2 signatures (requestor + direct manager)', color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
    { name: 'Director / VP', maxGU: 55, approver: 'Function head', sla: '3 business days', controls: 'Business case + risk assessment', signatures: '2 signatures + Legal review', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
    { name: 'C-Suite', maxGU: 80, approver: 'CxO / ExCo member', sla: '5 business days', controls: 'Full diligence package', signatures: '3 signatures + Legal + Finance review', color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
    { name: 'Board', maxGU: 100, approver: 'Board of Directors', sla: 'Next board cycle', controls: 'Board paper + external advisors', signatures: 'Board resolution + Legal + Finance + External advisors', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  ],

  // === SCORING ANCHORS ===
  // Defines what each score means per dimension
  // The AI uses these to score consistently
  anchors: {
    financial: {
      label: 'Financial Exposure',
      icon: '💰',
      description: 'Total monetary value at risk',
      unit: 'USD',
      points: [
        { score: 1, label: '< $10K', description: 'Petty cash / minor procurement' },
        { score: 2, label: '$10K – $100K', description: 'Departmental budget items' },
        { score: 4, label: '$100K – $1M', description: 'Significant expenditure' },
        { score: 7, label: '$1M – $10M', description: 'Major investment' },
        { score: 10, label: '> $10M', description: 'Strategic / transformational' },
      ],
    },
    reversibility: {
      label: 'Reversibility',
      icon: '🔄',
      description: 'How easily can this decision be undone?',
      points: [
        { score: 1, label: 'Fully reversible', description: 'Cancel anytime, no cost' },
        { score: 3, label: 'Mostly reversible', description: 'Some sunk cost / friction' },
        { score: 5, label: 'Partially reversible', description: 'Significant unwinding cost' },
        { score: 8, label: 'Mostly irreversible', description: 'Contractual lock-in, reputational' },
        { score: 10, label: 'Irreversible', description: 'Cannot be undone once executed' },
      ],
    },
    regulatory: {
      label: 'Regulatory & Compliance',
      icon: '⚖️',
      description: 'Exposure to regulatory, legal, or compliance risk',
      points: [
        { score: 1, label: 'None', description: 'No regulatory dimension' },
        { score: 3, label: 'Low', description: 'Standard compliance, well-understood' },
        { score: 5, label: 'Moderate', description: 'Requires legal review' },
        { score: 8, label: 'High', description: 'Cross-jurisdictional, novel regulatory' },
        { score: 10, label: 'Critical', description: 'License-to-operate risk' },
      ],
    },
    reputational: {
      label: 'Reputational Impact',
      icon: '📢',
      description: 'Potential impact on brand, stakeholders, or public trust',
      points: [
        { score: 1, label: 'Internal only', description: 'No external visibility' },
        { score: 3, label: 'Limited', description: 'Small stakeholder group aware' },
        { score: 5, label: 'Moderate', description: 'Industry / partner visibility' },
        { score: 8, label: 'Significant', description: 'Media / public attention likely' },
        { score: 10, label: 'Severe', description: 'Front-page risk' },
      ],
    },
    precedent: {
      label: 'Precedent Setting',
      icon: '📐',
      description: 'Does this create a new pattern others will follow?',
      points: [
        { score: 1, label: 'Routine', description: 'Done many times before' },
        { score: 3, label: 'Minor variation', description: 'Slight deviation from norm' },
        { score: 5, label: 'New approach', description: 'First time for this unit' },
        { score: 8, label: 'Org-wide precedent', description: 'Will shape future decisions' },
        { score: 10, label: 'Industry precedent', description: 'Novel in the market' },
      ],
    },
    complexity: {
      label: 'Stakeholder Complexity',
      icon: '🕸️',
      description: 'Number and diversity of affected parties',
      points: [
        { score: 1, label: 'Single team', description: 'One team, one function' },
        { score: 3, label: 'Cross-functional', description: 'Multiple internal teams' },
        { score: 5, label: 'Cross-BU', description: 'Multiple business units' },
        { score: 8, label: 'External parties', description: 'Partners, JVs, regulators' },
        { score: 10, label: 'Ecosystem-wide', description: 'Broad external stakeholder web' },
      ],
    },
  },

  // === FLOOR RULES (NON-COMPENSABILITY) ===
  // Prevents high risk in one dimension from being diluted by low risk in others
  floorRules: [
    { condition: 'any_single_gte', threshold: 9, minTier: 3, label: 'Any single dimension ≥ 9 → minimum C-Suite', enabled: true },
    { condition: 'any_single_gte', threshold: 10, minTier: 4, label: 'Any single dimension = 10 → minimum Board', enabled: true },
    { condition: 'any_two_gte', threshold: 7, minTier: 2, label: 'Any two dimensions ≥ 7 → minimum Director/VP', enabled: true },
    { condition: 'any_three_gte', threshold: 5, minTier: 2, label: 'Any three dimensions ≥ 5 → minimum Director/VP', enabled: false },
  ],
};

// === GU COMPUTATION ENGINE ===
// Deterministic — given the same scores, config, and profile, always returns the same result

export function computeGU(scores, config, profileId) {
  const profile = config.profiles[profileId];
  if (!profile) return null;
  const weights = profile.weights;
  const tiers = config.tiers;

  // Step 1: Weighted sum
  let total = 0;
  const breakdown = [];
  for (const [dim, weight] of Object.entries(weights)) {
    const raw = typeof scores[dim] === 'number' ? scores[dim] : (scores[dim]?.score || 1);
    const weighted = raw * weight * 10;
    total += weighted;
    breakdown.push({ dimension: dim, raw, weight, weighted });
  }
  const gu = Math.round(total * 10) / 10;

  // Step 2: Base tier from GU
  let tierIndex = tiers.findIndex(t => gu <= t.maxGU);
  if (tierIndex === -1) tierIndex = tiers.length - 1;

  // Step 3: Apply floor rules (non-compensability)
  const scoreValues = Object.values(scores).map(s => typeof s === 'number' ? s : (s?.score || 1));
  let floorApplied = null;

  for (const rule of config.floorRules) {
    if (!rule.enabled) continue;

    let triggered = false;
    if (rule.condition === 'any_single_gte') {
      triggered = scoreValues.some(s => s >= rule.threshold);
    } else if (rule.condition === 'any_two_gte') {
      triggered = scoreValues.filter(s => s >= rule.threshold).length >= 2;
    } else if (rule.condition === 'any_three_gte') {
      triggered = scoreValues.filter(s => s >= rule.threshold).length >= 3;
    }

    if (triggered && rule.minTier > tierIndex) {
      tierIndex = rule.minTier;
      floorApplied = rule.label;
    }
  }

  const tier = tiers[tierIndex] || tiers[tiers.length - 1];

  return { gu, tier, tierIndex, breakdown, floorApplied };
}

// Build scoring anchor text for the AI system prompt from config
export function buildAnchorPrompt(config) {
  const lines = [];
  for (const [dim, anchor] of Object.entries(config.anchors)) {
    const pts = anchor.points.map(p => `${p.score}=${p.label}`).join(' | ');
    lines.push(`**${anchor.label}**: ${pts}`);
  }
  return lines.join('\n');
}

// Build floor rules text for the AI
export function buildFloorRulesPrompt(config) {
  return config.floorRules
    .filter(r => r.enabled)
    .map(r => `- ${r.label}`)
    .join('\n');
}
