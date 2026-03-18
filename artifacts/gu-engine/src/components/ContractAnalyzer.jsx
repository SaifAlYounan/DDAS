import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { computeGU } from '../config';
import { useTheme } from '../App';
import { useHistory } from '../App';

const SAMPLES = [
  {
    label: 'Solar EPC $145M',
    icon: '\u2600\uFE0F',
    text: `EPC Contract: 200MW solar PV plant, Ras Al Khaimah, UAE.
Contractor: SunPower MENA FZE (first-time counterparty, DIFC incorporated).
Contract value: $145M, milestone-based tranches over 24 months.
Performance bond: 10% from UAE-licensed bank. LDs: $50K/day delay, capped at 15% of contract value.
Performance ratio guarantee: 80.5% at PR test, degradation max 0.5%/year for 25 years.
Land: 400ha, 30-year usufruct from RAK Municipality.
Regulatory: EWEC generation license, FEWA grid connection agreement, EAD environmental permit approved.
Insurance: CAR policy $150M minimum, 3rd party liability $20M.
Governing law: UAE Federal Law, DIAC arbitration (Dubai).
JV: 60% CleanCo / 40% sovereign wealth fund partner.
EPC warranty: 2-year defects liability, 10-year structural. Modules: 25-year linear degradation warranty.
First utility-scale project with this JV structure and contractor.`
  },
  {
    label: 'Wind Farm PPA',
    icon: '\uD83C\uDF2C\uFE0F',
    text: `Power Purchase Agreement: 400MW onshore wind farm, Dhafra region, Abu Dhabi.
Seller: Al Riyah Clean Energy LLC (SPV, 70% CleanCo / 30% international utility).
Buyer: EWEC (Emirates Water & Electricity Company) — sovereign-backed offtaker.
Term: 25 years from COD, with 5-year extension option at buyer's election.
Pricing: AED 0.085/kWh base tariff, indexed to UAE CPI annually (cap 2.5%), floor at base.
Take-or-pay: 90% of P50 annual generation (buyer bears curtailment risk above 5% threshold, seller bears first 5%).
Grid connection: 132kV, TRANSCO responsible for connection works. Delay risk shared — 6-month grace before LDs apply.
Dispatch: Priority dispatch confirmed by EWEC system operator under existing renewable policy.
Curtailment compensation: 80% of deemed energy for grid curtailment, 0% for force majeure curtailment.
Insurance: Operational all-risks $500M, business interruption 24 months.
Change of law: Buyer bears cost of discriminatory changes; seller bears general changes.
Governing law: Abu Dhabi law, ADCCAC arbitration.
Turbine technology: Vestas V150-4.2 (proven platform, 5-year full-service agreement).`
  },
  {
    label: 'Green Hydrogen JV',
    icon: '\uD83D\uDFE2',
    text: `Joint Venture Agreement: Green Hydrogen Production Facility, Ruwais Industrial City, Abu Dhabi.
Parties: CleanCo (40%), ADNOC (40%), international electrolyzer OEM (20% — technology partner).
Facility: 200MW electrolyzer, producing 25,000 tonnes green H2/year.
Total investment: $2.1B over 4-year development + construction period.
Offtake: 100% to ADNOC refining operations (captive demand, 15-year take-or-pay).
Technology: PEM electrolysis (Plug Power / Siemens — final selection pending). Technology risk: largest PEM deployment in MENA.
Power supply: Dedicated 200MW solar farm (separate PPA with CleanCo Energy).
Water: Desalinated seawater from existing ADNOC facility (supply agreement required).
Regulatory: Novel — no existing UAE hydrogen regulatory framework. Abu Dhabi DOE hydrogen strategy applies. ADNOC HSE standards.
Land: ADNOC industrial zone allocation, 30-year renewable lease.
Governance: Board of 5 (2 CleanCo, 2 ADNOC, 1 tech partner). Unanimous consent for: capex > $50M, technology changes, new offtake agreements.
Exit: 3-year lock-in. ROFR on transfers. Drag-along at 75%.
Carbon credits: Project to be registered under Verra VCS. Credits owned by JV, allocated pro-rata.
FEED completed. FID targeted Q3 2025.`
  },
  {
    label: 'Carbon Credit Offtake',
    icon: '\uD83D\uDCC4',
    text: `Carbon Credit Offtake Agreement: Forward purchase of Verified Carbon Units (VCUs).
Seller: East African Reforestation Trust (Kenyan entity, Verra-registered project developer).
Buyer: CleanCo Energy (Abu Dhabi entity).
Volume: 500,000 VCUs over 5 years (100K/year), vintage 2025-2029.
Price: $12/VCU fixed for Year 1-2, then indexed to S&P Global Platts Voluntary Carbon Market benchmark (floor $10, cap $25).
Methodology: Verra VCS VM0047 (Afforestation, Reforestation, Revegetation). Project ID: VCS-4521.
Delivery: Annual delivery to buyer's Verra registry account by March 31 each year.
Quality: VCUs must maintain Gold Standard CCB certification. If methodology invalidated, seller must substitute equivalent credits or refund.
Payment: 30% prepayment per vintage year, 70% on delivery and verification.
Governing law: DIFC law, DIFC-LCIA arbitration.
Representations: Seller warrants no double-counting, additionality maintained, no encumbrances.
Termination: Buyer may terminate on 12 months' notice if carbon market regulatory changes make credits non-compliant with EU CBAM or Article 6.
Insurance: Seller maintains project liability insurance $5M.
First carbon credit offtake for this buyer. Seller has 3 prior Verra projects (track record).`
  },
  {
    label: 'Vague Deal (test)',
    icon: '\u26A0\uFE0F',
    text: `We're looking at a consulting engagement with a firm in Riyadh. Roughly $400K over two years. They'd help us with our sustainability strategy and ESG reporting framework. My director wants to sign quickly because their lead consultant is about to be poached.`
  },
];

const DEMO_SETTLEMENT = `SETTLEMENT AGREEMENT — Dated 14 March 2022

Parties:
- Meridian Resources Corporation S.A. (Principal), 45 Avenue de la République, Libreville, Republic of Gabon
- Atlas Mining Services Ltd, Plot 7, Zone Industrielle, Libreville
- Consolidated Works International SAS, Tour Montparnasse, 33 Avenue du Maine, 75015 Paris, France (together "Contractor")

Background:
The Principal entered into a Mining Services Contract dated 15 September 2018 with the Contractor. Various claims and disputes arose during performance. On 22 November 2020, Principal submitted an Overburden Removal Claim to ICC Arbitration No. 26891/AZR. On 18 January 2021, Contractor introduced a counterclaim (Ore Hardness Claim). Additional disputes outside the arbitration include the Currency Dispute, Bench Height Dispute, Stockpile Loading Dispute, Blast Pattern Sampling dispute, and Cost Adjustment for Regional Labour Index 2022.

Settlement Terms:
2.1 Full and final settlement of all claims including: Overburden Removal Claim, Ore Hardness Claim, Currency Dispute, Bench Height Dispute, and Stockpile Loading Dispute.
2.2 Contractor also settles all other claims based on events prior to this Agreement, except two ongoing commercial discussions: (a) Blast Pattern Sampling — Impact on Drilling Productivity; (b) Cost Adjustment for Regional Labour Index 2022.
2.4 Parties shall jointly notify the ICC to terminate the Arbitration. Neither party may restart the arbitration or commence new proceedings on any settled claim.

Settlement Amount and Costs:
2.7 (a) Principal shall pay USD 650,000 to Contractor in full and final settlement.
(b) Each Party bears its own negotiation costs.
(c) Each Party bears its own legal costs for the Arbitration.
(d) ICC fees reimbursed shall be paid to Principal (who paid USD 25,000; Contractor paid nothing).
(e) If ICC requires additional payments: first USD 25,000 borne by Contractor alone; amounts beyond USD 25,000 shared equally.
2.8 Payment to: CONSOLIDATED WORKS INTERNATIONAL (USD), IBAN: FR76 0418 2700 9214 5600, BIC: BNPAFRPP (BNP Paribas, Paris).
2.9 Payment due within 30 days of execution. Late interest at 4.75% per annum, simple (not compound), from day 31.
2.10 Settlement amount is for settling Claims only, not to compensate for works done.

Operational Representations (non-binding on contract rates):
(a) Parties cooperating on overburden removal review criteria.
(b) Working together for weekly Mine Plan reliability within 12% variation.
(c) Optimising train loading time within contractual Export Ore quantity of 11.8 million tonnes/year.

Confidentiality (Clause 3): Strictly confidential. No disclosure of Agreement, terms, Arbitration existence or content, except as required by applicable law.

Governing Law: Laws of England and Wales. Disputes resolved by LCIA arbitration, London, three-arbitrator tribunal.

Standard Clauses: Entire agreement, no admission of liability, mutual indemnities, no third party beneficiaries, modifications in writing, no assignment without consent.`;

// Maps API score keys → config dimension keys
const API_SCORE_MAP = {
  financial_exposure: 'financial',
  reversibility: 'reversibility',
  regulatory_compliance: 'regulatory',
  reputational_impact: 'reputational',
  precedent_setting: 'precedent',
  stakeholder_complexity: 'complexity',
};

function normalizeScores(apiScores) {
  if (!apiScores) return {};
  const out = {};
  for (const [k, v] of Object.entries(apiScores)) {
    const key = API_SCORE_MAP[k] || k;
    out[key] = v;
  }
  return out;
}

const DIM_LABELS = {
  financial: 'Financial',
  reversibility: 'Reversibility',
  regulatory: 'Regulatory',
  reputational: 'Reputational',
  precedent: 'Precedent',
  complexity: 'Complexity',
};

const DIM_ORDER = ['financial', 'reversibility', 'regulatory', 'reputational', 'precedent', 'complexity'];

function RadarChart({ scores, size = 220 }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 30;
  const dims = DIM_ORDER;
  const n = dims.length;

  const getPoint = (i, value) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 10) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const gridLevels = [2, 4, 6, 8, 10];

  const scorePoints = dims.map((d, i) => {
    const score = typeof scores[d] === 'number' ? scores[d] : (scores[d]?.score || 1);
    return getPoint(i, score);
  });

  const polygonPath = scorePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid */}
      {gridLevels.map(level => {
        const points = dims.map((_, i) => getPoint(i, level));
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
        return <path key={level} d={path} fill="none" stroke="var(--border-primary)" strokeWidth={level === 10 ? 1.5 : 0.5} opacity={0.5} />;
      })}

      {/* Axes */}
      {dims.map((_, i) => {
        const end = getPoint(i, 10);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="var(--border-primary)" strokeWidth={0.5} opacity={0.3} />;
      })}

      {/* Score polygon fill */}
      <path d={polygonPath} fill="var(--accent-primary)" className="radar-fill" />

      {/* Score polygon stroke */}
      <path d={polygonPath} fill="none" stroke="var(--accent-primary)" strokeWidth={2.5} className="radar-polygon" strokeLinejoin="round" />

      {/* Score dots */}
      {scorePoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--accent-primary)" stroke="#fff" strokeWidth={2} className="score-reveal" style={{ animationDelay: `${0.5 + i * 0.1}s` }} />
      ))}

      {/* Labels */}
      {dims.map((d, i) => {
        const labelPt = getPoint(i, 12.5);
        return (
          <text key={d} x={labelPt.x} y={labelPt.y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 9, fontWeight: 700, fill: 'var(--text-tertiary)' }}>
            {DIM_LABELS[d]}
          </text>
        );
      })}
    </svg>
  );
}

function Confetti({ show }) {
  if (!show) return null;
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: 50 + (Math.random() - 0.5) * 80,
    y: 50 + (Math.random() - 0.5) * 60,
    color: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][i % 6],
    delay: Math.random() * 0.5,
    size: 4 + Math.random() * 6,
  }));

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size, borderRadius: p.id % 3 === 0 ? '50%' : 2,
          background: p.color,
          animation: `confettiPop 1s ease forwards ${p.delay}s`,
          opacity: 0,
        }} />
      ))}
    </div>
  );
}

function ScoreBar({ score }) {
  const pct = (score / 10) * 100;
  const h = 142 - (score / 10) * 142;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 7, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: `hsl(${h},70%,50%)`, transition: 'width 0.5s' }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: `hsl(${h},60%,40%)`, minWidth: 24, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="fade-in" style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
      <div style={{ width: '80%', padding: 16, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-primary)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 10 }}>DDAS</div>
        <div className="shimmer-loading" style={{ height: 12, marginBottom: 8, width: '90%' }} />
        <div className="shimmer-loading" style={{ height: 12, marginBottom: 8, width: '75%' }} />
        <div className="shimmer-loading" style={{ height: 12, marginBottom: 8, width: '85%' }} />
        <div className="shimmer-loading" style={{ height: 12, width: '60%' }} />
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const config = {
    high: { emoji: '\uD83D\uDD34', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' },
    medium: { emoji: '\uD83D\uDFE0', bg: '#fff7ed', color: '#9a3412', border: '#fed7aa' },
    low: { emoji: '\uD83D\uDFE1', bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
  };
  const c = config[severity] || config.medium;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {c.emoji} {severity}
    </span>
  );
}

function MiniBarChart({ profiles, currentProfile, getTier }) {
  const maxGU = 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Object.entries(profiles).map(([name, data]) => {
        const t = getTier(data.gu);
        const isCurrent = name === currentProfile;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)', width: 56, textAlign: 'right', textTransform: 'capitalize' }}>
              {name === 'publicCo' ? 'Public' : name === 'default' ? 'Balanced' : name}
            </span>
            <div style={{ flex: 1, height: isCurrent ? 10 : 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', transition: 'all 0.3s' }}>
              <div style={{
                width: `${Math.min(data.gu / maxGU * 100, 100)}%`, height: '100%',
                background: `linear-gradient(90deg, #10b981, ${t.color})`,
                borderRadius: 3, transition: 'width 0.5s ease',
              }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: t.color, minWidth: 28 }}>{data.gu}</span>
          </div>
        );
      })}
    </div>
  );
}

const SECTION_ICONS = {
  'Governance Assessment': '📋',
  'Risk Profile': '📊',
  'Contract Analysis': '🔍',
  'Risk Dimensions': '⚖️',
  'Key Findings': '🎯',
  'Cross-Profile Comparison': '🔄',
};

function MemoSection({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 8 }}>
      {SECTION_ICONS[label] && <span style={{ fontSize: 13, lineHeight: 1 }}>{SECTION_ICONS[label]}</span>}
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--text-secondary)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border-primary), transparent)' }} />
    </div>
  );
}

function VerdictCard({ result, liveGU, tier, tiers }) {
  const a = result.analysis;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const gu = liveGU.primary.gu;
  const docRef = `GOV-${String(gu).padStart(3, '0')}${tier.name.slice(0, 2).toUpperCase()}-${new Date().getFullYear()}`;
  const endorsements = (a?.endorsing_functions?.length > 0
    ? a.endorsing_functions
    : tier.signatures.split(/[+,·]/).map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'signatures' && !s.match(/^\d/))
  );

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-primary)',
      borderRadius: 12,
      marginBottom: 20,
      overflow: 'hidden',
      boxShadow: '0 2px 16px rgba(15,38,68,0.12)',
    }}>
      {/* Navy header bar */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2644 0%, #1e4a7a 100%)',
        padding: '11px 22px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15 }}>📄</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: 0.3 }}>Governance Assessment</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', letterSpacing: 1.2, textTransform: 'uppercase' }}>· DDAS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.45)', letterSpacing: 1 }}>{docRef}</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>{today}</span>
          <span style={{ fontSize: 8, fontWeight: 800, color: '#fca5a5', letterSpacing: 1.5, textTransform: 'uppercase' }}>Confidential</span>
        </div>
      </div>

      {/* RE / transaction summary */}
      {a?.transaction_summary && (
        <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', minWidth: 30, paddingTop: 3, flexShrink: 0 }}>RE</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.45 }}>{a.transaction_summary}</div>
              {a.transaction_type && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Type: {a.transaction_type}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3-column verdict row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr' }}>
        {/* Score */}
        <div style={{ padding: '16px 22px', borderRight: '1px solid var(--border-secondary)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Score</div>
          <div className="score-reveal" style={{ fontSize: 52, fontWeight: 900, color: tier.color, lineHeight: 1 }}>{gu}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>/ 100 GU</div>
        </div>

        {/* Approval Required — tier + approver + SLA in one column */}
        <div style={{ padding: '16px 18px', borderRight: '1px solid var(--border-secondary)' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Approval Required</div>
          <div style={{ display: 'inline-block', background: tier.bg, border: `2px solid ${tier.color}`, borderRadius: 8, padding: '5px 16px', marginBottom: 8 }}>
            <span className="score-reveal" style={{ fontSize: 20, fontWeight: 800, color: tier.color, animationDelay: '0.1s' }}>{tier.name}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{tier.approver}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SLA: <strong style={{ color: 'var(--text-secondary)' }}>{tier.sla}</strong></div>
          {liveGU.primary.floorApplied && (
            <div style={{ marginTop: 7, fontSize: 9, fontWeight: 700, color: '#ef4444', padding: '2px 7px', background: 'rgba(239,68,68,0.08)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.25)', display: 'inline-block' }}>
              ⚠ Floor rule applied
            </div>
          )}
        </div>

        {/* Endorsements */}
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Endorsements Required</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {endorsements.map((fn, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                borderRadius: 20, color: 'var(--text-secondary)',
              }}>{fn}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Tier scale bar */}
      <div style={{ padding: '8px 22px 10px', borderTop: '1px solid var(--border-secondary)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-secondary)' }}>
          {tiers.map(t => (
            <div key={t.name} style={{
              flex: 1, padding: '4px 3px', textAlign: 'center',
              background: tier.name === t.name ? '#0f2644' : 'var(--bg-card)',
              borderRight: '1px solid var(--border-secondary)',
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: tier.name === t.name ? '#fff' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Confidentiality footer */}
      <div style={{
        padding: '6px 22px',
        background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-secondary)',
        display: 'flex', gap: 7, alignItems: 'center',
        fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase',
      }}>
        <span>⚠</span>
        <span>Confidential — For Internal Use Only · Dynamic Delegation of Authority System</span>
      </div>
    </div>
  );
}

function DocSidebar({ liveGU, tier, handleExport, reset }) {
  const sections = [
    { label: 'Governance Assessment', icon: '📋' },
    { label: 'Risk Profile', icon: '📊' },
    { label: 'Contract Analysis', icon: '🔍' },
    { label: 'Risk Dimensions', icon: '⚖️' },
    { label: 'Key Findings', icon: '🎯' },
    { label: 'Cross-Profile Comparison', icon: '🔄' },
  ];

  return (
    <div className="doc-sidebar no-print" style={{
      width: 210, flexShrink: 0,
      position: 'sticky', top: 16,
      maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Status card */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #0f2644, #1e4a7a)',
          padding: '11px 14px',
        }}>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>
            Document Status
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0, boxShadow: '0 0 0 2px rgba(16,185,129,0.3)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Analysis Complete</span>
          </div>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
            Score
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, color: tier.color, lineHeight: 1, marginBottom: 8 }}>
            {liveGU.primary.gu}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}> / 100</span>
          </div>
          <div style={{
            display: 'inline-flex', padding: '3px 10px', borderRadius: 20,
            background: tier.bg, border: `1.5px solid ${tier.border}`,
            fontSize: 10, fontWeight: 800, color: tier.color,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            {tier.name} Tier
          </div>
        </div>
      </div>

      {/* Section navigation */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
      }}>
        <div style={{
          padding: '9px 14px 8px',
          fontSize: 9, fontWeight: 800, color: 'var(--text-muted)',
          letterSpacing: 2, textTransform: 'uppercase',
          borderBottom: '1px solid var(--border-secondary)',
        }}>
          Contents
        </div>
        {sections.map(({ label, icon }, i) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px',
            borderBottom: i < sections.length - 1 ? '1px solid var(--border-secondary)' : 'none',
            fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500,
          }}>
            <span style={{ fontSize: 11, flexShrink: 0 }}>{icon}</span>
            <span style={{ lineHeight: 1.3 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <button onClick={handleExport} className="btn-interactive" style={{
          padding: '10px 14px', borderRadius: 10,
          border: 'none', background: '#0f2644',
          color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%', boxShadow: '0 2px 8px rgba(15,38,68,0.25)',
        }}>
          📥 Download PDF
        </button>
        <button onClick={reset} className="btn-interactive" style={{
          padding: '9px 14px', borderRadius: 10,
          border: '1.5px solid var(--border-primary)', background: 'var(--bg-card)',
          color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          width: '100%',
        }}>
          ↩ New Analysis
        </button>
      </div>
    </div>
  );
}

// ── PDF / Print helpers ─────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreHue(score) { return 142 - (score / 10) * 142; }

function buildRadarSVG(scores, size = 260) {
  const cx = size / 2, cy = size / 2, radius = size / 2 - 44;
  const n = DIM_ORDER.length;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (v / 10) * radius;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const grid = [2, 4, 6, 8, 10].map(lv => {
    const d = DIM_ORDER.map((_, i) => pt(i, lv))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';
    return `<path d="${d}" fill="none" stroke="#cbd5e1" stroke-width="${lv === 10 ? 1.5 : 0.5}"/>`;
  }).join('');
  const axes = DIM_ORDER.map((_, i) => {
    const e = pt(i, 10);
    return `<line x1="${cx}" y1="${cy}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.8"/>`;
  }).join('');
  const spts = DIM_ORDER.map((d, i) => {
    const s = scores[d]; const v = typeof s === 'number' ? s : (s?.score ?? 1);
    return pt(i, v);
  });
  const poly = spts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z';
  const dots = DIM_ORDER.map((d, i) => {
    const s = scores[d]; const v = typeof s === 'number' ? s : (s?.score ?? 1);
    const p = spts[i]; const h = scoreHue(v);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="hsl(${h},70%,50%)" stroke="white" stroke-width="2"/>`;
  }).join('');
  const lbls = DIM_ORDER.map((d, i) => {
    const lp = pt(i, 13.5);
    return `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="font-size:9px;font-weight:700;fill:#64748b;font-family:system-ui,sans-serif">${DIM_LABELS[d]}</text>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${grid}${axes}<path d="${poly}" fill="#0f2644" fill-opacity="0.15" stroke="#0f2644" stroke-width="2.5" stroke-linejoin="round"/>${dots}${lbls}</svg>`;
}

function generateReportHTML({ result, liveGU, config, profile = 'default' }) {
  const a = result.analysis || {};
  const scores = a.scores || {};
  const ca = a.contract_analysis || {};
  const { tier, gu, floorApplied, breakdown = [] } = liveGU.primary;
  const { tiers, anchors } = config;
  const reportId = `DDAS-${Date.now().toString(36).toUpperCase()}`;
  const generated = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateOnly = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── helpers ──────────────────────────────────────────────────────────────

  const cell = (content, style = '') =>
    `<td style="padding:9px 12px;border:1px solid #d1d5db;vertical-align:top;${style}">${content}</td>`;

  const hcell = (content, style = '') =>
    `<th style="padding:7px 12px;border:1px solid #d1d5db;background:#f3f4f6;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;${style}">${content}</th>`;

  const sevLabel = (sev) => {
    if (sev === 'high')   return `<span style="font-weight:800;color:#b91c1c;font-size:10px;letter-spacing:0.5px">&#9679; HIGH</span>`;
    if (sev === 'low')    return `<span style="font-weight:800;color:#92400e;font-size:10px;letter-spacing:0.5px">&#9679; LOW</span>`;
    return `<span style="font-weight:800;color:#c2410c;font-size:10px;letter-spacing:0.5px">&#9679; MEDIUM</span>`;
  };

  // ── section: tier scale bar ───────────────────────────────────────────────
  const tierBar = tiers.map(t => {
    const active = t.name === tier.name;
    return `<div style="flex:1;padding:5px 3px;text-align:center;background:${active ? '#0f2644' : '#f3f4f6'};border:1px solid ${active ? '#0f2644' : '#d1d5db'}">
      <div style="font-size:9px;font-weight:${active ? 700 : 500};color:${active ? '#fff' : '#6b7280'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Arial,sans-serif">${escHtml(t.name)}</div>
    </div>`;
  }).join('');

  // ── section: dimension score table rows ───────────────────────────────────
  const dimTableRows = DIM_ORDER.map(k => {
    const v = scores[k]; const m = anchors[k]; if (!v || !m) return '';
    const score = typeof v === 'number' ? v : (v?.score ?? 1);
    const bd = breakdown.find(b => b.dimension === k);
    const bar = `<div style="display:flex;align-items:center;gap:6px">
      <div style="width:72px;height:5px;background:#e5e7eb;display:inline-block">
        <div style="width:${(score / 10) * 100}%;height:100%;background:#1f2937"></div>
      </div>
      <span style="font-weight:800;font-size:14px;font-family:Arial,sans-serif">${score}<span style="font-size:10px;font-weight:400;color:#6b7280">/10</span></span>
      ${bd ? `<span style="font-size:10px;color:#6b7280">(${bd.weighted.toFixed(1)} GU)</span>` : ''}
    </div>`;
    return `<tr>
      ${cell(`<span style="font-weight:600;font-size:13px">${escHtml(m.label)}</span>`, 'width:155px')}
      ${cell(bar, 'white-space:nowrap;width:165px')}
      ${cell(v?.rationale ? `<span style="font-size:12px;line-height:1.65;color:#374151">${escHtml(v.rationale)}</span>` : '—')}
    </tr>`;
  }).join('');

  // ── section: red flags table rows ─────────────────────────────────────────
  const flagRows = (ca.red_flags || []).map((f, i) => `<tr style="${i % 2 ? 'background:#f9fafb' : ''}">
    ${cell(`<div style="font-weight:600;font-size:13px;margin-bottom:3px">${escHtml(f.issue)}</div>${f.clause_reference ? `<div style="font-size:10px;color:#6b7280">${escHtml(f.clause_reference)}</div>` : ''}`)}
    ${cell(sevLabel(f.severity), 'text-align:center;white-space:nowrap;width:85px')}
    ${cell(f.recommendation ? `<span style="font-size:12px;line-height:1.6">${escHtml(f.recommendation)}</span>` : '—', 'width:38%')}
  </tr>`).join('');

  // ── section: missing provisions rows ─────────────────────────────────────
  const missingRows = (ca.missing_provisions || []).map((mp, i) => `<tr style="${i % 2 ? 'background:#f9fafb' : ''}">
    ${cell(`<span style="font-weight:600;font-size:13px">${escHtml(mp.provision)}</span>`, 'width:30%')}
    ${cell(mp.risk ? `<span style="font-size:12px">${escHtml(mp.risk)}</span>` : '—')}
    ${cell(mp.recommendation ? `<span style="font-size:12px">${escHtml(mp.recommendation)}</span>` : '—', 'width:35%')}
  </tr>`).join('');

  // ── section: positive features rows ──────────────────────────────────────
  const posRows = (ca.positive_features || []).map((pf, i) => `<tr style="${i % 2 ? 'background:#f9fafb' : ''}">
    ${cell(`<span style="font-weight:600;font-size:13px">${escHtml(pf.feature)}</span>`, 'width:38%')}
    ${cell(pf.benefit ? `<span style="font-size:12px">${escHtml(pf.benefit)}</span>` : '—')}
  </tr>`).join('');

  // ── section: cross-profile comparison rows ────────────────────────────────
  const profileRows = Object.entries(liveGU.allProfiles || {}).map(([n, d], i) => {
    const t = tiers.find(t2 => d.gu <= t2.maxGU) || tiers[tiers.length - 1];
    const isActive = n === profile;
    const prof = config.profiles[n];
    return `<tr style="${i % 2 ? 'background:#f9fafb' : ''}${isActive ? ';font-weight:700' : ''}">
      ${cell(`${escHtml(prof?.label || n)}${isActive ? ' <span style="font-size:10px;color:#0f2644">(active)</span>' : ''}`, 'font-size:13px')}
      ${cell(`<span style="font-weight:800;font-size:15px;font-family:Arial,sans-serif">${d.gu}</span>`, 'text-align:center;width:70px')}
      ${cell(escHtml(t.name), 'width:115px')}
      ${cell(escHtml(t.approver))}
      ${cell(escHtml(t.sla), 'width:120px')}
    </tr>`;
  }).join('');

  // ── section: assumptions rows ─────────────────────────────────────────────
  const assumptions = ca.assumptions || [];
  const assumptionRows = assumptions.map((as, i) => `<tr style="${i % 2 ? 'background:#f9fafb' : ''}">
    ${cell(`<span style="font-size:12px">${escHtml(as.assumption)}</span>`, 'width:45%')}
    ${cell(`<span style="font-size:12px">${escHtml(as.impact || '—')}</span>`)}
  </tr>`).join('');

  // ── section heading helper ────────────────────────────────────────────────
  const sh = (label) => `<div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#374151;border-bottom:1.5px solid #111827;padding-bottom:4px;margin:28px 0 13px">${label}</div>`;

  // ─────────────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>DDAS Governance Memo — ${escHtml(a.transaction_summary || reportId)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;font-size:13px;line-height:1.55;color:#111827;background:#fff;max-width:820px;margin:0 auto;padding:40px 48px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{width:100%;border-collapse:collapse;margin-bottom:6px}
th,td{padding:9px 12px;border:1px solid #d1d5db;vertical-align:top}
th{background:#f3f4f6;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-family:Arial,sans-serif}
@media print{body{padding:0} @page{margin:1.8cm 1.5cm;size:A4}}
</style>
</head><body>

<!-- VERDICT CARD -->
<div style="border:2px solid #0f2644;border-radius:6px;overflow:hidden;margin-bottom:26px">
  <!-- Header -->
  <div style="background:#0f2644;padding:10px 18px;display:flex;justify-content:space-between;align-items:center">
    <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:800;color:#fff;letter-spacing:0.3px">📄 Governance Assessment <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.45);letter-spacing:1px;text-transform:uppercase">· DDAS</span></div>
    <div style="font-family:Arial,sans-serif;font-size:9px;color:rgba(255,255,255,0.55);display:flex;align-items:center;gap:14px">
      <span style="font-family:monospace;font-size:10px;color:rgba(255,255,255,0.6)">${reportId}</span>
      <span>${dateOnly}</span>
      <span style="font-weight:800;color:#fca5a5;letter-spacing:1px;text-transform:uppercase;font-size:8px">Confidential</span>
    </div>
  </div>
  ${a.transaction_summary ? `<!-- RE line -->
  <div style="padding:12px 18px;background:#f8fafc;border-bottom:1px solid #d1d5db">
    <div style="display:flex;gap:14px;align-items:flex-start">
      <span style="font-family:Arial,sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;min-width:28px;padding-top:3px;flex-shrink:0">RE</span>
      <div>
        <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#0f2644;line-height:1.4">${escHtml(a.transaction_summary)}</div>
        ${a.transaction_type ? `<div style="font-family:Arial,sans-serif;font-size:11px;color:#6b7280;margin-top:4px">Type: ${escHtml(a.transaction_type)}</div>` : ''}
      </div>
    </div>
  </div>` : ''}
  <!-- 3-column verdict row -->
  <div style="display:grid;grid-template-columns:auto 1fr 1fr;border-top:1px solid #d1d5db">
    <div style="padding:14px 18px;border-right:1px solid #d1d5db">
      <div style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:4px">Score</div>
      <div style="font-family:Arial,sans-serif;font-size:50px;font-weight:900;color:#0f2644;line-height:1">${gu}</div>
      <div style="font-family:Arial,sans-serif;font-size:10px;color:#6b7280;margin-top:2px">/ 100 GU</div>
      ${floorApplied ? `<div style="margin-top:8px;font-family:Arial,sans-serif;font-size:9px;font-weight:700;color:#b91c1c">&#9888; Floor rule applied</div>` : ''}
    </div>
    <div style="padding:14px 18px;border-right:1px solid #d1d5db">
      <div style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">Approval Required</div>
      <div style="font-family:Arial,sans-serif;font-size:19px;font-weight:800;color:#0f2644;margin-bottom:6px">${escHtml(tier.name)}</div>
      <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;margin-bottom:5px">${escHtml(tier.approver)}</div>
      <div style="font-family:Arial,sans-serif;font-size:10px;color:#6b7280">SLA: <strong style="color:#111827">${escHtml(tier.sla)}</strong></div>
    </div>
    <div style="padding:14px 18px">
      <div style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">Endorsements Required</div>
      <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:600;color:#374151;line-height:1.6">${
        (a.endorsing_functions && a.endorsing_functions.length > 0
          ? a.endorsing_functions
          : tier.signatures.split(/[+,·]/).map(s => s.trim()).filter(s => s && !s.match(/^\d/))
        ).join(' · ')
      }</div>
    </div>
  </div>
  <!-- Tier scale bar -->
  <div style="padding:8px 18px 10px;background:#f3f4f6;border-top:1px solid #d1d5db">
    <div style="font-family:Arial,sans-serif;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:4px">Approval Tier Scale</div>
    <div style="display:flex;gap:0">${tierBar}</div>
  </div>
  <!-- Confidentiality footer -->
  <div style="padding:6px 18px;background:#f9fafb;border-top:1px solid #d1d5db;font-family:Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280">
    Confidential — For Internal Use Only · Dynamic Delegation of Authority System
  </div>
</div>

<!-- GOVERNANCE RATIONALE -->
${(a.risk_rationale || a.overall_risk_narrative) ? `${sh('Governance Rationale')}
<div style="padding:10px 14px;border-left:4px solid #0f2644;background:#f9fafb;font-size:12px;line-height:1.7;color:#1f2937;font-style:italic">${escHtml(a.risk_rationale || a.overall_risk_narrative)}</div>` : ''}

<!-- RISK DIMENSION ANALYSIS -->
${sh('Risk Dimension Analysis')}
<table>
  <thead><tr>${hcell('Dimension', 'width:155px')}${hcell('Score', 'width:165px')}${hcell('AI Rationale')}</tr></thead>
  <tbody>${dimTableRows || `<tr><td colspan="3" style="color:#6b7280;font-style:italic;padding:12px">No dimension scores available.</td></tr>`}</tbody>
</table>

<!-- RADAR CHART -->
<div style="text-align:center;margin:24px 0;padding:20px 20px 14px;border:1px solid #e5e7eb;background:#fafafa">
  <div style="font-family:Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:10px">Risk Profile — Radar View</div>
  ${buildRadarSVG(scores, 240)}
</div>

<!-- RED FLAGS -->
${(ca.red_flags || []).length > 0 ? `${sh(`Red Flags (${ca.red_flags.length})`)}
<table>
  <thead><tr>${hcell('Issue')}${hcell('Severity', 'width:85px;text-align:center')}${hcell('Recommendation', 'width:38%')}</tr></thead>
  <tbody>${flagRows}</tbody>
</table>` : ''}

<!-- MISSING PROVISIONS -->
${(ca.missing_provisions || []).length > 0 ? `${sh(`Missing Provisions (${ca.missing_provisions.length})`)}
<table>
  <thead><tr>${hcell('Provision', 'width:30%')}${hcell('Risk')}${hcell('Recommendation', 'width:35%')}</tr></thead>
  <tbody>${missingRows}</tbody>
</table>` : ''}

<!-- POSITIVE FEATURES -->
${(ca.positive_features || []).length > 0 ? `${sh('Positive Features')}
<table>
  <thead><tr>${hcell('Feature', 'width:38%')}${hcell('Benefit')}</tr></thead>
  <tbody>${posRows}</tbody>
</table>` : ''}

<!-- SCORING ASSUMPTIONS -->
${assumptions.length > 0 ? `${sh('Scoring Assumptions')}
<table>
  <thead><tr>${hcell('Assumption', 'width:45%')}${hcell('Impact on Score')}</tr></thead>
  <tbody>${assumptionRows}</tbody>
</table>` : ''}

<!-- CONTRACTUAL CONDITIONS BEFORE EXECUTION -->
${(a.approval_conditions || []).length > 0 ? `${sh('Contractual Conditions Before Execution')}
<div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px">
<ol style="padding-left:20px;margin:0">
  ${(a.approval_conditions || []).map(c => `<li style="margin-bottom:7px;font-size:12px;line-height:1.65;color:#78350f">${escHtml(c)}</li>`).join('')}
</ol></div>` : ''}

<!-- CROSS-PROFILE COMPARISON -->
${Object.keys(liveGU.allProfiles || {}).length > 1 ? `${sh('Cross-Profile Comparison')}
<p style="font-size:12px;color:#6b7280;margin-bottom:9px">Same transaction scored under different organizational risk appetite profiles.</p>
<table>
  <thead><tr>${hcell('Organization Profile')}${hcell('Score', 'width:70px;text-align:center')}${hcell('Approval Tier', 'width:115px')}${hcell('Required Approver')}${hcell('SLA', 'width:120px')}</tr></thead>
  <tbody>${profileRows}</tbody>
</table>` : ''}

<!-- DOCUMENT FOOTER -->
<div style="margin-top:40px;padding-top:12px;border-top:2px solid #0f2644;display:flex;justify-content:space-between;align-items:flex-end;font-family:Arial,sans-serif;font-size:9px;color:#6b7280">
  <div>
    <div style="font-weight:700;color:#0f2644;margin-bottom:2px">Dynamic Delegation of Authority System (DDAS)</div>
    <div>This document is generated by an AI-assisted governance tool. Results should be reviewed by qualified legal and risk professionals before action is taken.</div>
  </div>
  <div style="text-align:right;white-space:nowrap;margin-left:20px">
    <div style="font-weight:700;font-family:monospace;font-size:10px;color:#374151">${reportId}</div>
    <div>Confidential &amp; Privileged</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},650);};</script>
</body></html>`;
}

// ────────────────────────────────────────────────────────────────────────────

export default function ContractAnalyzer({ config, restoredResult, onResultClear, onExportReady, onHasResult }) {
  const { theme } = useTheme();
  const { addToHistory } = useHistory();
  const TIERS = config.tiers;
  const anchors = config.anchors;
  const getTier = (gu) => TIERS.find(t => gu <= t.maxGU) || TIERS[TIERS.length - 1];
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState('default');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState(null);
  const [chat, setChat] = useState([]);
  const [apiHistory, setApiHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);
  const [manualScores, setManualScores] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const endRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, loading]);

  const LOADING_STAGES = [
    { msg: 'Reading contract…', target: 20 },
    { msg: 'Scoring risk dimensions…', target: 50 },
    { msg: 'Generating governance recommendation…', target: 75 },
    { msg: 'Building governance memo…', target: 88 },
  ];
  useEffect(() => {
    if (!loading) {
      setLoadingStage(0);
      setLoadingProgress(0);
      return;
    }
    setLoadingStage(0);
    setLoadingProgress(5);
    const timings = [0, 7000, 15000, 22000];
    const stageTimers = timings.map((delay, i) =>
      setTimeout(() => {
        setLoadingStage(i);
        setLoadingProgress(LOADING_STAGES[i].target);
      }, delay)
    );
    const tick = setInterval(() => {
      setLoadingProgress(p => Math.min(p + 0.4, 88));
    }, 300);
    return () => {
      stageTimers.forEach(clearTimeout);
      clearInterval(tick);
    };
  }, [loading]);

  // Handle restored result from history
  useEffect(() => {
    if (restoredResult) {
      setResult(restoredResult);
      setChat([{ from: 'done' }]);
      setManualScores(null);
    }
  }, [restoredResult]);

  // Live GU computation
  const liveGU = useMemo(() => {
    if (!result || !result.analysis?.scores) return null;
    const aiScores = result.analysis.scores;
    const activeScores = {};
    for (const dim of Object.keys(config.anchors)) {
      activeScores[dim] = manualScores?.[dim] ?? aiScores[dim]?.score ?? 1;
    }

    const allProfiles = {};
    for (const profName of Object.keys(config.profiles)) {
      allProfiles[profName] = computeGU(activeScores, config, profName);
    }

    return { primary: allProfiles[profile], allProfiles, hasOverrides: manualScores !== null };
  }, [result, manualScores, profile, config]);

  // Save to history when result arrives
  useEffect(() => {
    if (result && liveGU && !restoredResult) {
      const a = result.analysis;
      addToHistory({
        id: Date.now(),
        timestamp: Date.now(),
        summary: a.transaction_summary || 'Contract Analysis',
        type: a.transaction_type || 'Unknown',
        gu: liveGU.primary.gu,
        fullResult: result,
      });
      // Trigger confetti
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1500);
    }
  }, [result]);

  const setDimScore = (dim, score) => {
    setManualScores(prev => ({ ...(prev || {}), [dim]: score }));
  };

  const resetDimScore = (dim) => {
    setManualScores(prev => {
      if (!prev) return null;
      const next = { ...prev };
      delete next[dim];
      return Object.keys(next).length === 0 ? null : next;
    });
  };

  const resetAllScores = () => setManualScores(null);

  const reset = () => {
    setChat([]); setApiHistory([]); setResult(null); setInput('');
    setError(null); setFile(null); setManualScores(null); setRetryCount(0);
    if (onResultClear) onResultClear();
  };

  const send = async (retryText, displayText) => {
    const txt = (retryText || input).trim();
    if (!txt && !file) return;
    setError(null);

    if (!retryText || displayText) {
      const display = displayText || [file ? `\uD83D\uDCCE ${file.name}` : '', txt].filter(Boolean).join('\n');
      setChat(prev => [...prev, { from: 'user', text: display }]);
    }

    setLoading(true);
    try {
      let res;

      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('text', txt || '');
        formData.append('history', JSON.stringify(apiHistory));
        formData.append('context', JSON.stringify({ profile }));
        res = await fetch('/api/analyze', { method: 'POST', body: formData });
      } else {
        const newHistory = [...apiHistory, { role: 'user', content: txt }];
        setApiHistory(newHistory);
        res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: newHistory, context: { profile } }),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      setRetryCount(0);

      if (data.status === 'needs_info') {
        const assistantContent = JSON.stringify(data.data);
        setApiHistory(prev => [...prev, { role: 'assistant', content: assistantContent }]);
        setChat(prev => [...prev, { from: 'ai', type: 'questions', data: data.data }]);
      } else if (data.status === 'scored') {
        // Normalize score keys from API format → config dimension keys
        if (data.analysis?.scores) {
          data.analysis.scores = normalizeScores(data.analysis.scores);
        }
        const assistantContent = JSON.stringify(data.analysis);
        setApiHistory(prev => [...prev, { role: 'assistant', content: assistantContent }]);
        setResult(data);
        setChat(prev => [...prev, { from: 'done' }]);
      } else if (data.status === 'fallback') {
        // Try to recover scored data from raw text (server may have missed JSON extraction)
        let recovered = null;
        try {
          const match = data.rawText.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.scores || parsed.status === 'scored') {
              recovered = { status: 'scored', analysis: parsed };
            }
          }
        } catch { /* ignore */ }

        if (recovered) {
          if (recovered.analysis?.scores) {
            recovered.analysis.scores = normalizeScores(recovered.analysis.scores);
          }
          setApiHistory(prev => [...prev, { role: 'assistant', content: JSON.stringify(recovered.analysis) }]);
          setResult(recovered);
          setChat(prev => [...prev, { from: 'done' }]);
        } else {
          setApiHistory(prev => [...prev, { role: 'assistant', content: data.rawText }]);
          setChat(prev => [...prev, { from: 'ai', type: 'text', text: data.rawText }]);
        }
      }
    } catch (err) {
      const msg = err.message;
      // Auto-retry on transient errors (max 2 retries)
      if (retryCount < 2 && (msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('529'))) {
        setRetryCount(prev => prev + 1);
        setError(`${msg} — retrying automatically...`);
        setTimeout(() => send(txt), 2000 * (retryCount + 1));
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
      if (!retryText) {
        setInput('');
        setFile(null);
      }
    }
  };

  const handleExport = useCallback(() => {
    if (!result || !liveGU) return;
    const html = generateReportHTML({ result, liveGU, config, profile });
    const win = window.open('', '_blank');
    if (!win) {
      alert('Pop-ups are blocked. Please allow pop-ups for this page to download the PDF report.');
      return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      try { win.document.defaultView.print(); } catch (_) { /* inline script fallback */ }
    }, 650);
  }, [result, liveGU, config, profile]);

  useEffect(() => { if (onExportReady) onExportReady(result && liveGU ? handleExport : null); }, [result, liveGU, handleExport, onExportReady]);
  useEffect(() => { if (onHasResult) onHasResult(!!result); }, [result, onHasResult]);

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const active = chat.length > 0;

  const cardStyle = {
    background: 'var(--bg-card)', borderRadius: 12,
    border: '1px solid var(--border-primary)',
    boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
  };

  return (
    <div>
      {/* Print header — only visible when printing */}
      <div className="print-only print-header" style={{ display: 'none' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Dynamic Delegation of Authority System</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>DDAS — Governance Assessment Report</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b' }}>
          <div>Generated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</div>
          <div>Report ID: DDAS-{Date.now().toString(36).toUpperCase()}</div>
        </div>
      </div>

      {/* Demo box: org profile + sample contracts (idle state only) */}
      {!active && (
        <div className="profile-selector no-print" style={{ ...cardStyle, marginBottom: 14, padding: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '16px 18px', background: 'linear-gradient(135deg, rgba(15,38,68,0.10) 0%, rgba(30,74,122,0.16) 100%)', borderBottom: '1px solid rgba(30,74,122,0.20)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px 4px 10px', borderRadius: 20, background: 'var(--bg-user-msg)', flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-secondary)' }} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.95)', textTransform: 'uppercase' }}>Demo Environment</span>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              Running on <strong>default calibrations</strong> — a live deployment would use your organisation's Board-approved Risk Matrix and Risk Appetite instead.
            </p>
          </div>

          {/* Three-step layout */}
          <div style={{ padding: '0 18px' }}>

            {/* Step 1 */}
            <div style={{ display: 'flex', gap: 16, padding: '18px 0', borderBottom: '1px solid var(--border-secondary)', alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-user-msg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>1</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Select your organisation type</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Sets the template risk calibration for your sector</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(config.profiles).map(([id, prof]) => (
                    <button key={id} onClick={() => setProfile(id)} className="btn-interactive" style={{
                      padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: profile === id ? '2px solid var(--accent-primary)' : '1.5px solid var(--border-primary)',
                      background: profile === id ? 'var(--accent-primary-light)' : 'var(--bg-card)',
                      color: profile === id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      transition: 'all 0.15s',
                    }}>{prof.label}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ display: 'flex', gap: 16, padding: '18px 0', borderBottom: '1px solid var(--border-secondary)', alignItems: 'flex-start' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-user-msg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>2</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Provide your action or document</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Upload a PDF or image, or type a description in the box below — or if you prefer, just use our sample document</div>
                <button
                  onClick={() => send(DEMO_SETTLEMENT, '\u2696\uFE0F Sample: Settlement Agreement — Meridian Resources / Atlas Mining Services')}
                  className="btn-interactive"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
                    border: '1.5px solid var(--border-primary)',
                    background: 'var(--bg-card)',
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>⚖️</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>Use our sample document</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Settlement Agreement — Meridian Resources</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ display: 'flex', gap: 16, padding: '18px 0', alignItems: 'center' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-user-msg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)' }}>3</span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Click Analyze</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scores across 6 risk dimensions and returns a governance decision instantly</div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Profile selector — active state (result visible) */}
      {active && (
        <div className="profile-selector no-print" style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap', padding: '10px 14px' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Org profile:</span>
          {Object.entries(config.profiles).map(([id, prof]) => (
            <button key={id} onClick={() => setProfile(id)} className="btn-interactive" style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: profile === id ? '2px solid var(--accent-primary)' : '1.5px solid var(--border-primary)',
              background: profile === id ? 'var(--accent-primary-light)' : 'var(--bg-card)',
              color: profile === id ? 'var(--accent-primary)' : 'var(--text-muted)',
              transition: 'all 0.3s',
            }}>{prof.label}</button>
          ))}
          <button onClick={reset} className="btn-interactive" style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1.5px solid #fecaca', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#ef4444' }}>New Analysis</button>
        </div>
      )}


      {/* Chat area — visible once a conversation has started */}
      <div className="chat-area no-print" style={{
        ...cardStyle, background: 'var(--bg-chat)', maxHeight: 450, overflowY: 'auto',
        padding: active ? 16 : 0, marginBottom: 14, minHeight: active ? 120 : 0,
        display: active ? 'block' : 'none',
        transition: 'all 0.3s',
      }}>
        {chat.map((msg, i) => {
          if (msg.from === 'user') return (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: 'var(--bg-user-msg)', color: 'var(--text-inverse)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
            </div>
          );
          if (msg.from === 'done') return (
            <div key={i} style={{ textAlign: 'center', margin: '10px 0' }}>
              <span className="score-reveal" style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 14, background: '#ecfdf5', fontSize: 11, fontWeight: 700, color: '#059669' }}>Analysis complete — see results below</span>
            </div>
          );
          if (msg.from === 'ai' && msg.type === 'text') return (
            <div key={i} className="card-entrance" style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
              <div style={{ maxWidth: '85%', padding: '12px 16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 4 }}>DDAS</div>
                {msg.text}
              </div>
            </div>
          );
          if (msg.from === 'ai' && msg.type === 'questions') {
            const d = msg.data;
            return (
              <div key={i} className="card-entrance" style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                <div style={{ maxWidth: '90%', padding: '14px 16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 8 }}>DDAS</div>

                  {d.information_available?.length > 0 && (
                    <div style={{ padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 7, border: '1px solid var(--border-secondary)', marginBottom: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Identified</div>
                      {d.information_available.map((x, j) => <div key={j} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '1px 0' }}>— {x}</div>)}
                    </div>
                  )}

                  <div style={{ color: 'var(--text-primary)', marginBottom: 10 }}>To score this transaction, the system needs a few more details:</div>

                  <ol style={{ paddingLeft: 18, margin: '0 0 12px' }}>
                    {d.gaps?.map((g, j) => (
                      <li key={j} style={{ color: 'var(--text-primary)', marginBottom: 6 }}>{g.question}</li>
                    ))}
                  </ol>

                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Just type your answers numbered (e.g. 1. Yes, first time &nbsp; 2. Milestone-based with exit clause) — no need to repeat the questions.
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })}

        {loading && (
          <div>
            <div style={{ margin: '12px 0 8px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', overflow: 'hidden' }}>
              <div style={{ height: 3, background: '#f1f5f9', position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  background: 'linear-gradient(90deg, #0f2644, #5b8fbe)',
                  width: `${loadingProgress}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0f2644', opacity: 0.7,
                  animation: 'pulse 1.2s ease-in-out infinite' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>
                  {LOADING_STAGES[loadingStage]?.msg}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                  {Math.round(loadingProgress)}%
                </span>
              </div>
            </div>
            <LoadingSkeleton />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* === SCORED RESULTS === */}
      {result && liveGU && (() => {
        const tier = getTier(liveGU.primary.gu);
        const a = result.analysis;
        const aiScores = a.scores || {};
        return (
          <div className="card-entrance" style={{ position: 'relative' }}>
            <Confetti show={showConfetti} />

            <div className="doc-layout" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
            <VerdictCard result={result} liveGU={liveGU} tier={tier} tiers={TIERS} />

            {/* ══════════════════════════════════════════
                2. SPIDER / RADAR CHART
                ══════════════════════════════════════════ */}
            <MemoSection label="Risk Profile" />
            <div style={{ ...cardStyle, padding: 20, marginBottom: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
              <RadarChart scores={aiScores} />
            </div>

            {/* ══════════════════════════════════════════
                3. RISK DIMENSIONS — 3×2 score card grid
                ══════════════════════════════════════════ */}
            <MemoSection label="Risk Dimensions" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
              {DIM_ORDER.map(k => {
                const v = aiScores[k];
                const score = typeof v === 'number' ? v : (v?.score ?? 1);
                const label = anchors[k]?.label || k;
                const h = 142 - (score / 10) * 142;
                const color = `hsl(${h},70%,48%)`;
                const barBg = `hsl(${h},60%,93%)`;
                return (
                  <div key={k} style={{
                    background: 'var(--bg-card)', borderRadius: 10, padding: '16px 18px',
                    border: '1px solid var(--border-primary)',
                    boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 40, fontWeight: 900, color, lineHeight: 1, marginBottom: 10 }}>{score}<span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>/10</span></div>
                    <div style={{ height: 7, background: barBg, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${score * 10}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ══════════════════════════════════════════
                4. RISK DIMENSION SCORES + GOVERNANCE RATIONALE
                ══════════════════════════════════════════ */}
            <MemoSection label="Risk Dimension Scores & Governance Rationale" />
            <div className="dimension-scores-section" style={{ ...cardStyle, padding: 20, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Risk Dimension Scores</div>
                {liveGU.hasOverrides && (
                  <button onClick={resetAllScores} className="no-print manual-override-controls btn-interactive" style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                    Reset to AI scores
                  </button>
                )}
              </div>
              <p className="no-print" style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>Drag sliders to override the AI scoring. Score recalculates live.</p>
              {Object.entries(aiScores).map(([k, v]) => {
                const m = anchors[k]; if (!m) return null;
                const aiScore = typeof v === 'number' ? v : (v?.score ?? 1);
                const levelLabel = v?.level || m.points?.slice().reverse().find(p => p.score <= aiScore)?.label || '';
                const currentScore = manualScores?.[k] ?? aiScore;
                const isOverridden = manualScores?.[k] !== undefined;
                const bd = liveGU.primary.breakdown.find(b => b.dimension === k);
                const h = 142 - (currentScore / 10) * 142;
                return (
                  <div key={k} className="card-entrance" style={{
                    padding: 12, marginBottom: 8, borderRadius: 10,
                    background: isOverridden ? '#fffbeb' : 'var(--bg-hover)',
                    border: `1px solid ${isOverridden ? '#fde68a' : 'var(--border-secondary)'}`,
                    transition: 'all 0.3s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, flex: 1, color: 'var(--text-primary)' }}>{m.label}</span>
                      {isOverridden && (
                        <button onClick={() => resetDimScore(k)} title="Reset to AI score" className="no-print manual-override-controls btn-interactive" style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>
                          AI: {aiScore}
                        </button>
                      )}
                      {levelLabel && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', padding: '2px 6px', background: 'var(--bg-tertiary)', borderRadius: 3 }}>{levelLabel}</span>}
                      {bd && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>{bd.weighted.toFixed(1)}</span>}
                    </div>
                    <div className="slider-control no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 10 }}>1</span>
                      <input
                        type="range" min={1} max={10} step={1} value={currentScore}
                        onChange={e => setDimScore(k, parseInt(e.target.value))}
                        style={{ flex: 1, height: 6, cursor: 'pointer', accentColor: `hsl(${h},70%,50%)` }}
                      />
                      <span style={{ fontSize: 18, fontWeight: 800, color: `hsl(${h},60%,40%)`, minWidth: 28, textAlign: 'right', transition: 'color 0.3s' }}>{currentScore}</span>
                    </div>
                    <div className="print-only" style={{ display: 'none', marginBottom: 6 }}>
                      <ScoreBar score={currentScore} />
                    </div>
                    {v?.rationale && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 4, padding: '8px 10px', background: 'var(--bg-card)', borderRadius: 6, borderLeft: '2px solid var(--accent-primary)' }}>{v.rationale}</div>}
                  </div>
                );
              })}
              {/* Governance Rationale narrative */}
              {(a.risk_rationale || a.overall_risk_narrative) && (
                <div style={{
                  marginTop: 14, padding: '12px 16px',
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                  borderLeft: '3px solid var(--accent-primary)',
                  borderRadius: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 6 }}>Governance Rationale</div>
                  {a.risk_rationale || a.overall_risk_narrative}
                </div>
              )}
            </div>

            {/* ══════════════════════════════════════════
                5. CONTRACTUAL CONDITIONS BEFORE EXECUTION
                (conditions + red flags + missing provisions)
                ══════════════════════════════════════════ */}
            {(() => {
              const conditions = a.approval_conditions || a.recommended_conditions || a.approval_conditions_before_execution || [];
              const redFlags = a.contract_analysis?.red_flags || [];
              const missingProvisions = a.contract_analysis?.missing_provisions || [];
              const positiveFeatures = a.contract_analysis?.positive_features || [];
              const assumptions = a.contract_analysis?.assumptions || a.contract_analysis?.assumptions_made || [];
              if (conditions.length === 0 && redFlags.length === 0 && missingProvisions.length === 0 && positiveFeatures.length === 0) return null;
              return (
                <>
                  <MemoSection label="Contractual Conditions Before Execution" />
                  <div style={{ marginBottom: 14 }}>
                    {/* Conditions */}
                    {conditions.length > 0 && (
                      <div className="card-entrance" style={{
                        background: '#fffbeb', borderRadius: 10, padding: '14px 18px', marginBottom: 10,
                        border: '1px solid #fde68a', borderLeft: '4px solid #f59e0b',
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#92400e', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>
                          Conditions Before Execution
                        </div>
                        {conditions.map((c, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                            <span style={{ fontWeight: 800, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Red Flags */}
                    {redFlags.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 8 }}>Red Flags ({redFlags.length})</div>
                        {redFlags.map((f, i) => (
                          <div key={i} className="card-entrance" style={{
                            padding: 12, marginBottom: 6, borderRadius: 8,
                            background: f.severity === 'high' ? '#fef2f2' : f.severity === 'medium' ? '#fff7ed' : '#fefce8',
                            border: `1px solid ${f.severity === 'high' ? '#fecaca' : f.severity === 'medium' ? '#fed7aa' : '#fef08a'}`,
                            animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
                          }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                              <SeverityBadge severity={f.severity} />
                              {f.clause_reference && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.clause_reference}</span>}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{f.issue}</div>
                            <div style={{ fontSize: 12, color: '#059669', fontStyle: 'italic', marginTop: 3 }}>{f.recommendation}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Missing Provisions */}
                    {missingProvisions.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 14 }}>{'\u26A0\uFE0F'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>Missing Provisions ({missingProvisions.length})</span>
                        </div>
                        {missingProvisions.map((mp, i) => (
                          <div key={i} className="card-entrance" style={{
                            padding: 12, marginBottom: 6, borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a',
                            animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <span style={{ fontSize: 12 }}>{'\uD83D\uDCCB'}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>{mp.provision}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#a16207', marginTop: 2 }}>{mp.risk}</div>
                            <div style={{ fontSize: 12, color: '#059669', fontStyle: 'italic', marginTop: 2 }}>{mp.recommendation}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Positive Features */}
                    {positiveFeatures.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 14 }}>{'\u2705'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Positive Features</span>
                        </div>
                        {positiveFeatures.map((pf, i) => (
                          <div key={i} className="card-entrance" style={{
                            padding: 10, marginBottom: 4, borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0',
                            animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
                          }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>{pf.feature}</div>
                            <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>{pf.benefit}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Assumptions */}
                    {assumptions.length > 0 && (
                      <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px dashed var(--border-primary)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Assumptions Made</div>
                        {assumptions.map((x, i) => {
                          if (typeof x === 'string') return <div key={i} style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '2px 0' }}>- {x}</div>;
                          return (
                            <div key={i} style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '3px 0' }}>
                              <span style={{ fontWeight: 600 }}>- {x.assumption}</span>
                              {x.impact && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}> — {x.impact}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            <MemoSection label="Cross-Profile Comparison" />
            {/* Cross-profile comparison */}
            <div className="cross-profile-section" style={{ ...cardStyle, padding: 20, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>Same Transaction, Different Organizations</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>How the score shifts by organizational risk appetite</p>

              {/* Mini bar chart comparison */}
              <div style={{ marginBottom: 16 }}>
                <MiniBarChart profiles={liveGU.allProfiles} currentProfile={profile} getTier={getTier} />
              </div>

              <div className="profile-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                {Object.entries(liveGU.allProfiles).map(([n, d], idx) => {
                  const t = getTier(d.gu); const on = n === profile;
                  return (
                    <div key={n} onClick={() => setProfile(n)} className="card-entrance btn-interactive" style={{
                      padding: 14, borderRadius: 10,
                      background: on ? t.bg : 'var(--bg-hover)',
                      border: on ? `2px solid ${t.border}` : '1px solid var(--border-secondary)',
                      textAlign: 'center', cursor: 'pointer',
                      animationDelay: `${idx * 0.05}s`, animationFillMode: 'backwards',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>{config.profiles[n]?.label || n}{on && ' *'}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: t.color, margin: '4px 0' }}>{d.gu} <span style={{ fontSize: 13 }}>GU</span></div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: t.color }}>{t.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Print footer */}
            <div className="print-only print-footer" style={{ display: 'none' }}>
              Generated by DDAS | {new Date().toLocaleDateString()} | Confidential
            </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* Input area */}
      {!result && (
        <div className="input-area no-print" style={{
          ...cardStyle,
          padding: '14px 16px',
        }}>
          {/* Upload zone + OR divider — idle state only */}
          {!active && (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  cursor: 'pointer',
                  border: '2px dashed var(--border-primary)',
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  padding: '18px 16px',
                  textAlign: 'center',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                  marginBottom: 4,
                  transition: 'border-color 0.2s, background 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent-primary)';
                  e.currentTarget.style.background = 'var(--accent-primary-light)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-primary)';
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14,2 14,8 20,8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Upload a document</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Click to attach a PDF or image (contract, deck, memorandum)</div>
                </div>
              </div>

              {/* OR divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '10px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-secondary)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1 }}>OR</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border-secondary)' }} />
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8 }}>
                Describe your action or transaction
              </div>
            </>
          )}

          {/* Attached file badge */}
          {file && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--accent-primary-light)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)', border: '1px solid var(--border-primary)' }}>
                <span style={{ fontSize: 13 }}>📎</span>
                {file.name}
                <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, fontWeight: 700, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            </div>
          )}

          <div className="input-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={e => { setFile(e.target.files[0] || null); e.target.value = ''; }} style={{ display: 'none' }} />
            {active && (
              <button
                onClick={() => fileRef.current?.click()}
                className="btn-interactive"
                title="Attach a PDF or image"
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  border: '1.5px solid var(--border-primary)',
                  background: 'var(--bg-tertiary)', cursor: 'pointer',
                  fontSize: 16, color: 'var(--text-tertiary)', minHeight: 44,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
            )}
            <textarea
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              placeholder={active ? "Answer the system's questions, or add more detail..." : 'Paste a contract, describe a transaction, or type a question...'}
              rows={active ? 2 : 4}
              style={{
                flex: 1, padding: 12, borderRadius: 10, border: '1.5px solid var(--border-primary)',
                fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', resize: 'vertical',
                fontFamily: 'inherit', outline: 'none', minHeight: active ? 44 : 90,
                background: 'var(--bg-input)', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--border-focus)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-primary)'}
            />
            <button onClick={() => send()} disabled={loading || (!input.trim() && !file)} className="btn-interactive" style={{
              padding: '12px 22px', borderRadius: 10, border: 'none', cursor: loading ? 'wait' : 'pointer',
              background: loading ? 'var(--text-muted)' : 'var(--accent-primary)', color: '#fff',
              fontSize: 13, fontWeight: 700, minHeight: 44,
              opacity: (!input.trim() && !file) ? 0.5 : 1,
              boxShadow: loading ? 'none' : 'var(--shadow-accent)',
              transition: 'all 0.2s',
            }}>{loading ? 'Analyzing…' : active ? 'Send' : 'Analyze →'}</button>
          </div>
        </div>
      )}

      {error && (
        <div className="card-entrance" style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            {error}
            {retryCount > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>(retry {retryCount}/2)</span>}
          </div>
          {retryCount === 0 && !loading && (
            <button onClick={() => send()} className="btn-interactive" style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid #fecaca',
              background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#dc2626',
              whiteSpace: 'nowrap',
            }}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
