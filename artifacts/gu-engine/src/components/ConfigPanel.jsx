import { useState } from 'react';

const DIMS = ['financial', 'reversibility', 'regulatory', 'reputational', 'precedent', 'complexity'];

const AI_SCORING_SCALES = [
  {
    key: 'financial',
    label: 'Financial Exposure',
    icon: '💰',
    desc: 'Total monetary value at risk',
    levels: [
      { score: 1,  text: '< $100K — office supplies, routine maintenance spare parts, feasibility study' },
      { score: 2,  text: '$100K–$1M — consultancy engagement, site survey, small rooftop solar' },
      { score: 3,  text: '$1M–$10M — BESS installation, grid connection works, carbon credit offtake' },
      { score: 4,  text: '$10M–$50M — small utility-scale solar, equipment procurement' },
      { score: 5,  text: '$50M–$100M — medium solar/wind EPC, substation upgrade' },
      { score: 6,  text: '$100M–$250M — large utility-scale project, significant EPC' },
      { score: 7,  text: '$250M–$500M — major EPC contract, large PPA portfolio' },
      { score: 8,  text: '$500M–$1B — large-scale renewable portfolio, major concession' },
      { score: 9,  text: '$1B–$3B — green hydrogen facility, major JV, infrastructure mega-project' },
      { score: 10, text: '> $3B — sovereign-scale infrastructure, multi-GW program, transformational M&A' },
    ],
  },
  {
    key: 'reversibility',
    label: 'Reversibility',
    icon: '🔄',
    desc: 'How easily can this decision be undone?',
    levels: [
      { score: 1,  text: 'Fully reversible — NDA, MoU with no binding obligations, feasibility study' },
      { score: 2,  text: 'Easily reversible — short-term consultancy with 30-day notice, equipment reservation' },
      { score: 3,  text: 'Mostly reversible — service contract with termination-for-convenience, pilot project' },
      { score: 4,  text: 'Reversible with cost — EPC contract with T-for-C clause, break fees apply' },
      { score: 5,  text: 'Partially reversible — mid-term PPA with break clause, equipment already ordered' },
      { score: 6,  text: 'Difficult to reverse — long-term PPA, construction underway, significant sunk costs' },
      { score: 7,  text: 'Very difficult — commissioned plant, operational commitments, staff hired' },
      { score: 8,  text: 'Mostly irreversible — JV with shared assets, M&A with deferred consideration, long-term concession' },
      { score: 9,  text: 'Nearly irreversible — permanent infrastructure built, sovereign guarantees issued' },
      { score: 10, text: 'Irreversible — permanent land transfer, irreversible environmental impact, sovereign guarantee called' },
    ],
  },
  {
    key: 'regulatory',
    label: 'Regulatory & Compliance',
    icon: '⚖️',
    desc: 'Exposure to regulatory, legal, or compliance risk',
    levels: [
      { score: 1,  text: 'None — internal procurement, no permits needed' },
      { score: 2,  text: 'Minimal — standard business license renewal, routine filing' },
      { score: 3,  text: 'Low — standard EWEC registration, routine EAD permits, established regulatory path' },
      { score: 4,  text: 'Low-moderate — multiple standard permits, cross-department coordination' },
      { score: 5,  text: 'Moderate — cross-emirate regulatory coordination, ADNOC procurement framework, technology certification' },
      { score: 6,  text: 'Moderate-high — new permit categories, regulatory pre-approval needed, multiple agencies' },
      { score: 7,  text: 'High — cross-border regulatory requirements, multiple jurisdictions, novel license categories' },
      { score: 8,  text: 'Very high — novel regulatory framework, cross-border JV structures, DIFC/onshore interplay, sanctions screening' },
      { score: 9,  text: 'Critical — first-of-kind regulatory pathway, potential for regulatory challenge, policy uncertainty' },
      { score: 10, text: 'Extreme — license-to-operate risk, novel hydrogen regulations, nuclear-adjacent, sovereign immunity implications' },
    ],
  },
  {
    key: 'reputational',
    label: 'Reputational Impact',
    icon: '📢',
    desc: 'Potential impact on brand, stakeholders, or public trust',
    levels: [
      { score: 1,  text: 'Internal only — back-office procurement, no external visibility' },
      { score: 2,  text: 'Minimal external — routine vendor engagement, no press interest' },
      { score: 3,  text: 'Limited — small industry circle aware, trade publication mention possible' },
      { score: 4,  text: 'Moderate-low — industry event visibility, partner announcement' },
      { score: 5,  text: 'Moderate — industry conference visibility, trade press coverage, JV announcements' },
      { score: 6,  text: 'Moderate-high — national media interest possible, government stakeholder awareness' },
      { score: 7,  text: 'Significant — international press likely, ESG scrutiny, brand association risk' },
      { score: 8,  text: 'High — sovereign/national champion brand association, COP/climate summit visibility, sovereign wealth fund involvement' },
      { score: 9,  text: 'Very high — front-page risk, parliamentary/regulatory inquiry possible, ESG rating impact' },
      { score: 10, text: 'Severe — international incident risk, greenwashing allegations, sovereign relationship damage, activist targeting' },
    ],
  },
  {
    key: 'precedent',
    label: 'Precedent Setting',
    icon: '📐',
    desc: 'Does this create a new pattern others will follow?',
    levels: [
      { score: 1,  text: 'Routine — repeat procurement, standard terms, done many times before' },
      { score: 2,  text: 'Near-routine — minor variation on established approach' },
      { score: 3,  text: 'Minor variation — slightly modified PPA terms, new supplier for existing category' },
      { score: 4,  text: 'Some novelty — new geography for existing product, adapted contract structure' },
      { score: 5,  text: 'New approach — first project in new emirate, new technology deployment, new contract structure' },
      { score: 6,  text: 'Significant novelty — first use of new commercial model, new partnership structure' },
      { score: 7,  text: 'Major precedent — new market entry, first large-scale deployment of emerging technology' },
      { score: 8,  text: 'Org-wide precedent — first green hydrogen project, new JV governance model, new market entry strategy' },
      { score: 9,  text: 'Industry precedent — first-of-kind in UAE/GCC, novel methodology, potential to reshape market' },
      { score: 10, text: 'Global precedent — first-of-kind globally, industry-shaping deal, new regulatory paradigm' },
    ],
  },
  {
    key: 'complexity',
    label: 'Stakeholder Complexity',
    icon: '🕸️',
    desc: 'Number and diversity of affected parties',
    levels: [
      { score: 1,  text: 'Single team — one department, one counterparty, simple approval' },
      { score: 2,  text: 'Two teams — buyer + seller, straightforward negotiation' },
      { score: 3,  text: 'Cross-functional — engineering + procurement + legal, multiple internal teams' },
      { score: 4,  text: 'Multi-department — 3–4 internal teams, external advisors involved' },
      { score: 5,  text: 'Cross-BU — multiple business units, shared infrastructure, internal politics' },
      { score: 6,  text: 'Multiple external — 3+ external counterparties, advisors, consultants' },
      { score: 7,  text: 'Complex external — JV partners, lenders, government entity, EPC contractor' },
      { score: 8,  text: 'Highly complex — multiple government entities, regulators, lenders, JV partners, community stakeholders' },
      { score: 9,  text: 'Multi-sovereign — sovereign stakeholders from multiple countries, multilateral development banks' },
      { score: 10, text: 'Ecosystem-wide — international consortium, multiple sovereigns, multilateral institutions, global supply chain' },
    ],
  },
];

function scoreColor(score) {
  if (score <= 3) return { bg: '#f0fdf4', border: '#bbf7d0', numColor: '#15803d', textColor: '#166534' };
  if (score <= 6) return { bg: '#fefce8', border: '#fde68a', numColor: '#a16207', textColor: '#92400e' };
  return { bg: '#fef2f2', border: '#fecaca', numColor: '#b91c1c', textColor: '#991b1b' };
}
const DIM_COLORS = {
  financial: '#4338ca',
  reversibility: '#3b82f6',
  regulatory: '#f59e0b',
  reputational: '#ef4444',
  precedent: '#8b5cf6',
  complexity: '#10b981',
};

function Section({ title, desc, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-primary)', marginBottom: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,38,68,0.07)' }}>
      <button onClick={() => setOpen(!open)} className="btn-interactive" style={{
        width: '100%', padding: '13px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: open ? 'rgba(30,74,122,0.04)' : 'none',
        borderBottom: open ? '1px solid rgba(30,74,122,0.1)' : '1px solid transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.2s',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: open ? '#1e4a7a' : 'var(--text-primary)', transition: 'color 0.2s' }}>{title}</div>
          {desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>}
        </div>
        <span style={{ fontSize: 16, color: open ? '#1e4a7a' : 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s, color 0.2s' }}>{'\u25BE'}</span>
      </button>
      {open && <div className="card-entrance" style={{ padding: '14px 18px 18px' }}>{children}</div>}
    </div>
  );
}

function DimScaleCard({ dim }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, borderRadius: 10, border: '1px solid var(--border-secondary)', overflow: 'hidden', background: 'var(--bg-hover)' }}>
      <button onClick={() => setOpen(o => !o)} className="btn-interactive" style={{
        width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8,
        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{ fontSize: 16 }}>{dim.icon}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{dim.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{dim.desc}</span>
        </div>
        <div style={{ display: 'flex', gap: 2, marginRight: 8 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(s => (
            <div key={s} style={{ width: 6, height: 14, borderRadius: 2, background: s <= 3 ? '#22c55e' : s <= 6 ? '#eab308' : '#ef4444', opacity: 0.75 }} />
          ))}
        </div>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s' }}>▾</span>
      </button>
      {open && (
        <div className="card-entrance" style={{ padding: '2px 14px 12px' }}>
          {dim.levels.map(({ score, text }) => {
            const c = scoreColor(score);
            const dashIdx = text.indexOf(' — ');
            const label = dashIdx > -1 ? text.slice(0, dashIdx) : text;
            const example = dashIdx > -1 ? text.slice(dashIdx + 3) : null;
            return (
              <div key={score} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 10px', marginBottom: 4,
                borderRadius: 7, background: c.bg, border: `1px solid ${c.border}`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: c.numColor, minWidth: 20, paddingTop: 1 }}>{score}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: c.textColor }}>{label}</span>
                  {example && <span style={{ fontSize: 11, color: c.textColor, opacity: 0.72 }}> — {example}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeightDistributionBar({ weights, anchors }) {
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  return (
    <div style={{ marginTop: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 1 }}>
        {DIMS.map(dim => {
          const pct = total > 0 ? (weights[dim] / total) * 100 : 0;
          return (
            <div key={dim} style={{
              width: `${pct}%`,
              background: DIM_COLORS[dim],
              transition: 'width 0.3s ease',
              minWidth: pct > 0 ? 2 : 0,
            }}
              title={`${anchors[dim]?.label || dim}: ${(weights[dim] * 100).toFixed(0)}%`}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {DIMS.map(dim => (
          <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: DIM_COLORS[dim] }} />
            {anchors[dim]?.icon} {(weights[dim] * 100).toFixed(0)}%
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConfigPanel({ config, setConfig }) {
  const updateProfile = (profileId, dim, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.profiles[profileId].weights[dim] = value;
      return next;
    });
  };

  const updateTier = (index, field, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.tiers[index][field] = value;
      return next;
    });
  };

  const updateAnchor = (dim, pointIndex, field, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.anchors[dim].points[pointIndex][field] = value;
      return next;
    });
  };

  const toggleFloorRule = (index) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.floorRules[index].enabled = !next.floorRules[index].enabled;
      return next;
    });
  };

  const updateFloorRule = (index, field, value) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.floorRules[index][field] = value;
      return next;
    });
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gu-engine-config.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (imported.profiles && imported.tiers && imported.anchors) {
          setConfig(imported);
        } else {
          alert('Invalid config file');
        }
      } catch { alert('Could not parse config file'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const inputStyle = {
    padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border-primary)',
    fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-input)', color: 'var(--text-primary)',
    transition: 'border-color 0.3s',
  };

  return (
    <div>
      <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-primary)', borderLeft: '4px solid #1e4a7a', boxShadow: '0 1px 4px rgba(15,38,68,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(30,74,122,0.08)', border: '1px solid rgba(30,74,122,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e4a7a', flexShrink: 0 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 7.76a6 6 0 0 0 0 8.49"/></svg>
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>⚙️ Configuration</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>Scoring parameters, weights, tier boundaries, and governance rules. Changes apply immediately.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={exportConfig} className="btn-interactive" style={{ padding: '6px 14px', borderRadius: 6, border: '1.5px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13 }}>⬇</span> Export
          </button>
          <label className="btn-interactive" style={{ padding: '6px 14px', borderRadius: 6, border: '1.5px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 13 }}>⬆</span> Import
            <input type="file" accept=".json" onChange={importConfig} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* WEIGHT PROFILES */}
      <Section title="Weight Profiles" desc="How much each risk dimension contributes to the GU score. Weights must sum to 100%." defaultOpen={true}>
        {Object.entries(config.profiles).map(([profileId, profile]) => {
          const total = Object.values(profile.weights).reduce((s, v) => s + v, 0);
          const isValid = Math.abs(total - 1.0) < 0.01;
          return (
            <div key={profileId} style={{ marginBottom: 16, padding: 14, background: 'var(--bg-hover)', borderRadius: 10, border: '1px solid var(--border-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{profile.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: isValid ? '#059669' : '#dc2626', padding: '2px 8px', background: isValid ? '#ecfdf5' : '#fef2f2', borderRadius: 4, transition: 'all 0.3s' }}>
                  Sum = {(total * 100).toFixed(0)}% {isValid ? '' : '-- must be 100%'}
                </span>
              </div>

              {/* Weight distribution bar */}
              <WeightDistributionBar weights={profile.weights} anchors={config.anchors} />

              {DIMS.map(dim => {
                const anchor = config.anchors[dim];
                const w = profile.weights[dim];
                return (
                  <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, width: 22 }}>{anchor.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', width: 140, minWidth: 100 }}>{anchor.label}</span>
                    <div style={{ flex: 1, position: 'relative', minWidth: 80 }}>
                      <input type="range" min={0} max={50} step={1} value={Math.round(w * 100)}
                        onChange={e => updateProfile(profileId, dim, parseInt(e.target.value) / 100)}
                        style={{ width: '100%', cursor: 'pointer', accentColor: DIM_COLORS[dim] }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: DIM_COLORS[dim], minWidth: 40, textAlign: 'right', transition: 'color 0.3s' }}>{(w * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Section>

      {/* TIER BOUNDARIES */}
      <Section title="Approval Tiers" desc="GU thresholds that determine which authority level is required. Drag to adjust boundaries.">
        <div style={{ display: 'grid', gap: 10 }}>
          {config.tiers.map((tier, i) => {
            const prevMax = i > 0 ? config.tiers[i - 1].maxGU : 0;
            return (
              <div key={i} className="card-entrance" style={{
                padding: 14, borderRadius: 10, background: tier.bg, border: `1.5px solid ${tier.border}`,
                animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: tier.color }}>{tier.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{prevMax} \u2013 {tier.maxGU} GU</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 65 }}>Max GU:</span>
                  <input type="range" min={i > 0 ? config.tiers[i-1].maxGU + 1 : 5}
                    max={i < config.tiers.length - 1 ? config.tiers[i+1].maxGU - 1 : 100}
                    value={tier.maxGU}
                    onChange={e => updateTier(i, 'maxGU', parseInt(e.target.value))}
                    style={{ flex: 1, cursor: 'pointer', accentColor: tier.color }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: tier.color, minWidth: 32, textAlign: 'right', transition: 'color 0.3s' }}>{tier.maxGU}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>Approver</div>
                    <input type="text" value={tier.approver} onChange={e => updateTier(i, 'approver', e.target.value)}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>SLA</div>
                    <input type="text" value={tier.sla} onChange={e => updateTier(i, 'sla', e.target.value)}
                      style={{ ...inputStyle, width: '100%' }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* SCORING ANCHORS */}
      <Section title="Scoring Anchors" desc="Define what each score means per dimension. These anchors are sent to the AI so it scores consistently against your organization's definitions.">
        {DIMS.map(dim => {
          const anchor = config.anchors[dim];
          return (
            <div key={dim} style={{ marginBottom: 14, padding: 14, background: 'var(--bg-hover)', borderRadius: 10, border: '1px solid var(--border-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18 }}>{anchor.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{anchor.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{anchor.description}</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {anchor.points.map((pt, pi) => {
                  const hue = [142, 120, 45, 25, 0][pi] ?? 0;
                  return (
                    <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, background: `hsl(${hue}, 80%, 97%)`, border: `1px solid hsl(${hue}, 60%, 88%)`, flexWrap: 'wrap', transition: 'all 0.3s' }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: `hsl(${hue}, 60%, 40%)`, minWidth: 24 }}>{pt.score}</span>
                      <input type="text" value={pt.label} onChange={e => updateAnchor(dim, pi, 'label', e.target.value)}
                        style={{ ...inputStyle, width: 130, minWidth: 80, fontWeight: 600 }} />
                      <input type="text" value={pt.description} onChange={e => updateAnchor(dim, pi, 'description', e.target.value)}
                        style={{ ...inputStyle, flex: 1, minWidth: 120, color: 'var(--text-tertiary)' }} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Section>

      {/* AI SCORING SCALES */}
      <Section title="AI Scoring Scales" desc="The full 1–10 scale the AI uses for each dimension. Read-only — sourced from the system prompt. Use this as a reference when reviewing or overriding AI scores.">
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe', fontSize: 12, color: '#1e40af' }}>
          These scales are embedded in the AI system prompt. Each score has UAE renewable energy examples calibrated for large-scale transactions. Click any dimension to expand.
        </div>
        {AI_SCORING_SCALES.map(dim => <DimScaleCard key={dim.key} dim={dim} />)}
      </Section>

      {/* FLOOR RULES */}
      <Section title="Floor Rules (Non-Compensability)" desc="Prevent high risk in one dimension from being diluted by low scores elsewhere. These override the GU-based tier when triggered.">
        <div style={{ padding: 12, background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
            <strong>Why this matters:</strong> A linear GU model is compensable — a score of 10 on Regulatory can be "diluted" by 1s everywhere else, producing a low GU. Floor rules prevent this by enforcing minimum approval tiers regardless of total GU.
          </div>
        </div>
        {config.floorRules.map((rule, i) => (
          <div key={i} className="card-entrance" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: 12, marginBottom: 6,
            borderRadius: 8, background: rule.enabled ? '#f0fdf4' : 'var(--bg-hover)',
            border: `1px solid ${rule.enabled ? '#bbf7d0' : 'var(--border-primary)'}`,
            opacity: rule.enabled ? 1 : 0.6, flexWrap: 'wrap',
            transition: 'all 0.3s',
            animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
          }}>
            <button onClick={() => toggleFloorRule(i)} style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: rule.enabled ? '#10b981' : '#cbd5e1', position: 'relative', flexShrink: 0,
              transition: 'background 0.3s',
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2,
                left: rule.enabled ? 18 : 2, transition: 'left 0.3s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{rule.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                Minimum tier: <strong>{config.tiers[rule.minTier]?.name}</strong>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* METHODOLOGY NOTE */}
      <Section title="Methodology & Audit Trail" desc="How the model works and how to validate it">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 12 }}><strong>Model type:</strong> Weighted Linear Additive (Multi-Criteria Decision Analysis). Same mathematical structure as FICO credit scoring, APACHE clinical risk scores, and ISO 31000 risk frameworks.</p>
          <p style={{ marginBottom: 12 }}><strong>Formula:</strong> <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 3, color: 'var(--text-primary)' }}>GU = Sum(score x weight x 10)</code> where scores are in [1,10] and sum of weights = 1.0. Floor rules applied after computation.</p>
          <p style={{ marginBottom: 12 }}><strong>AI scoring:</strong> Uses Claude API with temperature 0 (deterministic) and a fixed random seed for maximum reproducibility. Scoring anchors from this configuration are embedded in the system prompt. Each score includes a written rationale for audit purposes.</p>
          <p style={{ marginBottom: 12 }}><strong>Calibration recommended:</strong> Score 50+ historical transactions through the model, compare to actual approval outcomes, and adjust weights/anchors to match organizational practice. Re-calibrate annually or after significant governance events.</p>
          <p style={{ marginBottom: 0 }}><strong>Limitations:</strong> The linear model assumes dimension independence and compensability (mitigated by floor rules). AI scores may vary slightly between runs despite deterministic settings — always allow human override for final decisions.</p>
        </div>
      </Section>
    </div>
  );
}
