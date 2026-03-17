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
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 10 }}>GU ADVISOR</div>
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
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${grid}${axes}<path d="${poly}" fill="#4338ca" fill-opacity="0.15" stroke="#4338ca" stroke-width="2.5" stroke-linejoin="round"/>${dots}${lbls}</svg>`;
}

function generateReportHTML({ result, liveGU, config }) {
  const a = result.analysis || {};
  const scores = a.scores || {};
  const ca = a.contract_analysis || {};
  const { tier, gu, floorApplied, breakdown = [] } = liveGU.primary;
  const { tiers, anchors } = config;
  const reportId = `GU-${Date.now().toString(36).toUpperCase()}`;
  const generated = new Date().toLocaleString();

  const scoreBar = (score) => {
    const h = scoreHue(score);
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;height:7px;background:#e2e8f0;border-radius:4px;overflow:hidden">
        <div style="width:${(score / 10) * 100}%;height:100%;background:hsl(${h},70%,50%);border-radius:4px"></div>
      </div>
      <span style="font-size:13px;font-weight:800;color:hsl(${h},55%,38%);min-width:24px;text-align:right">${score}</span>
    </div>`;
  };

  const sevColors = (sev) => {
    if (sev === 'high') return ['#fef2f2', '#fecaca', '#dc2626'];
    if (sev === 'low')  return ['#fefce8', '#fef08a', '#a16207'];
    return ['#fff7ed', '#fed7aa', '#ea580c'];
  };

  const tierBar = tiers.map((t, i) => {
    const active = t.name === tier.name;
    const r = i === 0 ? '5px 0 0 5px' : i === tiers.length - 1 ? '0 5px 5px 0' : '0';
    return `<div style="flex:1;padding:4px 2px;text-align:center;background:${active ? tier.color : '#f1f5f9'};border-radius:${r}">
      <div style="font-size:8px;font-weight:700;color:${active ? '#fff' : '#94a3b8'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.name)}</div>
    </div>`;
  }).join('');

  const dimRows = DIM_ORDER.map(k => {
    const v = scores[k]; const m = anchors[k]; if (!v || !m) return '';
    const score = typeof v === 'number' ? v : (v?.score ?? 1);
    const h = scoreHue(score);
    const lvl = m.points?.slice().reverse().find(p => p.score <= score)?.label || '';
    const bd = breakdown.find(b => b.dimension === k);
    return `<div style="padding:12px;margin-bottom:8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;break-inside:avoid">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:15px">${m.icon || ''}</span>
        <span style="font-size:13px;font-weight:700;color:#1e293b;flex:1">${escHtml(m.label)}</span>
        ${lvl ? `<span style="font-size:10px;font-weight:600;color:#64748b;padding:2px 6px;background:#e2e8f0;border-radius:3px">${escHtml(lvl)}</span>` : ''}
        ${bd ? `<span style="font-size:12px;font-weight:700;color:hsl(${h},60%,40%)">${bd.weighted.toFixed(1)} GU</span>` : ''}
      </div>
      ${scoreBar(score)}
      ${v?.rationale ? `<div style="font-size:12px;color:#475569;line-height:1.6;margin-top:6px">${escHtml(v.rationale)}</div>` : ''}
    </div>`;
  }).join('');

  const flagsHTML = (ca.red_flags || []).map(f => {
    const [bg, border, badge] = sevColors(f.severity);
    return `<div style="padding:12px;margin-bottom:6px;border-radius:8px;background:${bg};border:1px solid ${border};break-inside:avoid">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${badge};padding:2px 8px;background:white;border:1px solid ${border};border-radius:4px">${escHtml(f.severity || 'medium')}</span>
        ${f.clause_reference ? `<span style="font-size:10px;color:#94a3b8">${escHtml(f.clause_reference)}</span>` : ''}
      </div>
      <div style="font-size:13px;font-weight:600;color:#1e293b">${escHtml(f.issue)}</div>
      ${f.recommendation ? `<div style="font-size:12px;color:#059669;font-style:italic;margin-top:3px">${escHtml(f.recommendation)}</div>` : ''}
    </div>`;
  }).join('');

  const missingHTML = (ca.missing_provisions || []).map(mp =>
    `<div style="padding:12px;margin-bottom:6px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;break-inside:avoid">
      <div style="font-size:13px;font-weight:600;color:#92400e">${escHtml(mp.provision)}</div>
      ${mp.risk ? `<div style="font-size:12px;color:#a16207;margin-top:2px">${escHtml(mp.risk)}</div>` : ''}
      ${mp.recommendation ? `<div style="font-size:12px;color:#059669;font-style:italic;margin-top:2px">${escHtml(mp.recommendation)}</div>` : ''}
    </div>`).join('');

  const posHTML = (ca.positive_features || []).map(pf =>
    `<div style="padding:10px;margin-bottom:6px;border-radius:8px;background:#ecfdf5;border:1px solid #a7f3d0;break-inside:avoid">
      <div style="font-size:13px;font-weight:600;color:#065f46">${escHtml(pf.feature)}</div>
      ${pf.benefit ? `<div style="font-size:12px;color:#047857;margin-top:2px">${escHtml(pf.benefit)}</div>` : ''}
    </div>`).join('');

  const recsHTML = (a.key_recommendations || []).map(r =>
    `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #e2e8f0">
      <span style="color:#4338ca;font-weight:700;font-size:16px;line-height:1.4">›</span>
      <span style="font-size:13px;color:#1e293b;line-height:1.6">${escHtml(r)}</span>
    </div>`).join('');

  const narrativeHTML = a.overall_risk_narrative
    ? `<div style="padding:14px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;font-size:13px;color:#1e40af;line-height:1.7;margin-bottom:24px">${escHtml(a.overall_risk_narrative)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GU Report — ${escHtml(a.transaction_summary || reportId)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff;color:#1e293b;font-size:14px;line-height:1.6;padding:32px 40px;max-width:860px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h2{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:12px}
section{margin-bottom:28px}
@media print{body{padding:20px 24px} section{break-inside:avoid} @page{margin:1.5cm}}
</style>
</head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #1e293b;margin-bottom:24px">
  <div>
    <div style="font-size:18px;font-weight:800;color:#1e293b">Governance Unit Engine</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px">Contract Risk Assessment Report</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#64748b">
    <div>Generated: ${escHtml(generated)}</div>
    <div>Report ID: ${reportId}</div>
  </div>
</div>

<section style="background:${tier.bg};border-radius:12px;padding:20px 24px;border:2px solid ${tier.border}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px">Governance Cost</div>
      <div style="font-size:52px;font-weight:800;color:${tier.color};line-height:1.1">${gu}<span style="font-size:22px;font-weight:600"> GU</span></div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px">Required Tier</div>
      <div style="font-size:28px;font-weight:800;color:${tier.color}">${escHtml(tier.name)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">${escHtml(tier.approver)}</div>
      <div style="font-size:11px;color:#94a3b8">SLA: ${escHtml(tier.sla)}</div>
      ${floorApplied ? `<div style="margin-top:6px;font-size:10px;font-weight:700;color:#dc2626;padding:2px 8px;background:#fef2f2;border-radius:4px;display:inline-block">Floor rule: ${escHtml(floorApplied)}</div>` : ''}
    </div>
  </div>
  <div style="display:flex;margin-top:16px;gap:2px">${tierBar}</div>
  ${a.transaction_summary ? `<div style="margin-top:14px;padding:12px;background:#fff;border-radius:8px;border:1px solid #e2e8f0">
    <div style="font-size:14px;font-weight:600;color:#1e293b">${escHtml(a.transaction_summary)}</div>
    ${a.transaction_type ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;background:#f1f5f9;border-radius:4px;font-size:11px;font-weight:600;color:#475569">${escHtml(a.transaction_type)}</span>` : ''}
  </div>` : ''}
</section>

${narrativeHTML}

<section style="text-align:center">
  <h2 style="text-align:center">Risk Profile</h2>
  <div style="display:inline-block;padding:12px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">${buildRadarSVG(scores)}</div>
</section>

<section>
  <h2>Risk Dimension Scores</h2>
  ${dimRows || '<p style="color:#94a3b8;font-size:13px">No scores available.</p>'}
</section>

${(ca.red_flags || []).length > 0 ? `<section><h2 style="color:#dc2626">Red Flags (${ca.red_flags.length})</h2>${flagsHTML}</section>` : ''}

${(ca.missing_provisions || []).length > 0 ? `<section><h2 style="color:#d97706">&#9888; Missing Provisions (${ca.missing_provisions.length})</h2>${missingHTML}</section>` : ''}

${(ca.positive_features || []).length > 0 ? `<section><h2 style="color:#059669">&#10003; Positive Features</h2>${posHTML}</section>` : ''}

${(a.key_recommendations || []).length > 0 ? `<section><h2 style="color:#4338ca">Key Recommendations</h2>${recsHTML}</section>` : ''}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8">
  GU Engine &mdash; ${reportId} &mdash; Confidential &amp; Privileged &mdash; Not for external distribution
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},600);};</script>
</body></html>`;
}

// ────────────────────────────────────────────────────────────────────────────

export default function ContractAnalyzer({ config, restoredResult, onResultClear }) {
  const { theme } = useTheme();
  const { addToHistory } = useHistory();
  const TIERS = config.tiers;
  const anchors = config.anchors;
  const getTier = (gu) => TIERS.find(t => gu <= t.maxGU) || TIERS[TIERS.length - 1];
  const [input, setInput] = useState('');
  const [profile, setProfile] = useState('default');
  const [loading, setLoading] = useState(false);
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

  const send = async (retryText) => {
    const txt = (retryText || input).trim();
    if (!txt && !file) return;
    setError(null);

    if (!retryText) {
      const display = [file ? `\uD83D\uDCCE ${file.name}` : '', txt].filter(Boolean).join('\n');
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
    const html = generateReportHTML({ result, liveGU, config });
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
  }, [result, liveGU, config]);

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const active = chat.length > 0;

  const cardStyle = {
    background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-primary)',
  };

  return (
    <div>
      {/* Print header — only visible when printing */}
      <div className="print-only print-header" style={{ display: 'none' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Governance Unit Engine</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Contract Risk Assessment Report</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b' }}>
          <div>Generated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</div>
          <div>Report ID: GU-{Date.now().toString(36).toUpperCase()}</div>
        </div>
      </div>

      {/* Profile selector */}
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
        {active && <button onClick={reset} className="btn-interactive" style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1.5px solid #fecaca', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#ef4444' }}>New Analysis</button>}
      </div>

      {/* Samples */}
      {!active && (
        <div className="sample-buttons no-print" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Try:</span>
          {SAMPLES.map((s, i) => (
            <button key={i} onClick={() => { reset(); setTimeout(() => setInput(s.text), 30); }} className="btn-interactive" style={{
              padding: '5px 12px', borderRadius: 7, border: '1.5px solid var(--border-primary)',
              background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              color: 'var(--text-secondary)', transition: 'all 0.3s',
            }}>{s.icon} {s.label}</button>
          ))}
        </div>
      )}

      {/* Chat area */}
      <div className="chat-area no-print" style={{
        ...cardStyle, background: 'var(--bg-chat)', maxHeight: 450, overflowY: 'auto',
        padding: active ? 16 : 0, marginBottom: 14, minHeight: active ? 120 : 0,
        transition: 'all 0.3s',
      }}>
        {!active && !result && (
          <div onClick={() => fileRef.current?.click()} style={{ padding: 24, textAlign: 'center', cursor: 'pointer', transition: 'all 0.3s' }}>
            <div style={{ fontSize: 28 }}>{'\uD83D\uDCC4'}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 4 }}>Drop a contract here, or click to upload</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>PDF, images — or type/paste text below</div>
          </div>
        )}

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
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 4 }}>GU ADVISOR</div>
                {msg.text}
              </div>
            </div>
          );
          if (msg.from === 'ai' && msg.type === 'questions') {
            const d = msg.data;
            return (
              <div key={i} className="card-entrance" style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                <div style={{ maxWidth: '90%', padding: '14px 16px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-primary)', marginBottom: 8 }}>GU ADVISOR</div>
                  <div style={{ color: 'var(--text-primary)', marginBottom: 10 }}>{d.summary}</div>

                  {d.information_available?.length > 0 && (
                    <div style={{ padding: 10, background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#059669', textTransform: 'uppercase', marginBottom: 4 }}>Identified</div>
                      {d.information_available.map((x, j) => <div key={j} style={{ fontSize: 12, color: '#065f46', padding: '2px 0' }}>- {x}</div>)}
                    </div>
                  )}

                  <div style={{ padding: 10, background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', marginBottom: 6 }}>Need to know</div>
                    {d.gaps?.map((g, j) => (
                      <div key={j} style={{ padding: '8px 0', borderBottom: j < d.gaps.length - 1 ? '1px solid #fde68a' : 'none' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>{g.question}</div>
                        <div style={{ fontSize: 11, color: '#a16207', marginTop: 2 }}>
                          {g.why_it_matters}
                          {g.dimension_affected && <span style={{ marginLeft: 6, padding: '1px 6px', background: '#fef3c7', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>{g.dimension_affected}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })}

        {loading && <LoadingSkeleton />}
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

            {/* PDF Export + Actions Bar */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
              <button onClick={handleExport} className="btn-interactive" style={{
                padding: '6px 14px', borderRadius: 8, border: '1.5px solid var(--border-primary)',
                background: 'var(--bg-card)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {'\uD83D\uDCE5'} Download as PDF
              </button>
            </div>

            {/* GU Hero */}
            <div className="gu-hero" style={{ background: tier.bg, borderRadius: 14, padding: 24, border: `2px solid ${tier.border}`, marginBottom: 14, position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                    Governance Cost {liveGU.hasOverrides && <span style={{ color: '#f59e0b' }}>- manually adjusted</span>}
                  </div>
                  <div className="gu-hero-score score-reveal" style={{ fontSize: 50, fontWeight: 800, color: tier.color, lineHeight: 1.1 }}>{liveGU.primary.gu}<span style={{ fontSize: 20, fontWeight: 600 }}> GU</span></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1.5 }}>Required Tier</div>
                  <div className="gu-hero-tier score-reveal" style={{ fontSize: 28, fontWeight: 800, color: tier.color, animationDelay: '0.2s' }}>{tier.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{liveGU.primary.tier.approver}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>SLA: {liveGU.primary.tier.sla}</div>
                  {liveGU.primary.floorApplied && (
                    <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: '#dc2626', padding: '2px 8px', background: '#fef2f2', borderRadius: 4, display: 'inline-block' }}>
                      Floor rule: {liveGU.primary.floorApplied}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 16, height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(liveGU.primary.gu, 100)}%`, height: '100%', background: `linear-gradient(90deg,#10b981,${tier.color})`, borderRadius: 5, transition: 'width 0.5s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                {TIERS.map(t => <span key={t.name} style={{ fontSize: 9, fontWeight: 600, color: tier.name === t.name ? t.color : '#cbd5e1' }}>{t.name}</span>)}
              </div>
              {a.transaction_summary && (
                <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{a.transaction_summary}</div>
                  {a.transaction_type && <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', background: 'var(--bg-tertiary)', borderRadius: 4, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{a.transaction_type}</span>}
                </div>
              )}
            </div>

            {/* Radar Chart */}
            <div style={{ ...cardStyle, padding: 20, marginBottom: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: 'var(--text-primary)' }}>Risk Profile</h3>
              <RadarChart scores={aiScores} />
            </div>

            {/* Contract Analysis */}
            {a.contract_analysis && (
              <div className="contract-analysis-section" style={{ ...cardStyle, padding: 20, marginBottom: 14 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: 'var(--text-primary)' }}>Contract Analysis</h3>

                {a.contract_analysis.red_flags?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 8 }}>Red Flags ({a.contract_analysis.red_flags.length})</div>
                    {a.contract_analysis.red_flags.map((f, i) => (
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

                {a.contract_analysis.missing_provisions?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 14 }}>{'\u26A0\uFE0F'}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>Missing Provisions ({a.contract_analysis.missing_provisions.length})</span>
                    </div>
                    {a.contract_analysis.missing_provisions.map((mp, i) => (
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

                {a.contract_analysis.positive_features?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 14 }}>{'\u2705'}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Positive Features</span>
                    </div>
                    {a.contract_analysis.positive_features.map((pf, i) => (
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

                {(a.contract_analysis.assumptions?.length > 0 || a.contract_analysis.assumptions_made?.length > 0) && (
                  <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px dashed var(--border-primary)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Assumptions Made</div>
                    {(a.contract_analysis.assumptions || a.contract_analysis.assumptions_made || []).map((x, i) => {
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
            )}

            {/* Editable Dimension Scores */}
            <div className="dimension-scores-section" style={{ ...cardStyle, padding: 20, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Risk Dimension Scores</h3>
                {liveGU.hasOverrides && (
                  <button onClick={resetAllScores} className="no-print manual-override-controls btn-interactive" style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                    Reset to AI scores
                  </button>
                )}
              </div>
              <p className="no-print" style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>Drag sliders to override the AI scoring. GU recalculates live.</p>
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
                      {bd && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>{bd.weighted.toFixed(1)} GU</span>}
                    </div>
                    {/* Slider */}
                    <div className="slider-control no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 10 }}>1</span>
                      <input
                        type="range" min={1} max={10} step={1} value={currentScore}
                        onChange={e => setDimScore(k, parseInt(e.target.value))}
                        style={{ flex: 1, height: 6, cursor: 'pointer', accentColor: `hsl(${h},70%,50%)` }}
                      />
                      <span style={{ fontSize: 18, fontWeight: 800, color: `hsl(${h},60%,40%)`, minWidth: 28, textAlign: 'right', transition: 'color 0.3s' }}>{currentScore}</span>
                    </div>
                    {/* Print-only score display */}
                    <div className="print-only" style={{ display: 'none', marginBottom: 6 }}>
                      <ScoreBar score={currentScore} />
                    </div>
                    {v?.rationale && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{v.rationale}</div>}
                  </div>
                );
              })}
            </div>

            {/* Flags + Conditions */}
            {(() => {
              const keyRisks = a.key_risk_flags || a.key_risks || [];
              const conditions = a.recommended_conditions || a.approval_conditions || [];
              const recommendations = a.key_recommendations || [];
              const narrative = a.overall_risk_narrative || a.risk_narrative || '';
              const hasRisks = keyRisks.length > 0 || recommendations.length > 0 || narrative;
              const hasConditions = conditions.length > 0;
              if (!hasRisks && !hasConditions) return null;
              return (
                <div className="two-col-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                  {(keyRisks.length > 0 || recommendations.length > 0 || narrative) && (
                    <div className="risk-card card-entrance" style={{ background: '#fef2f2', borderRadius: 12, padding: 14, border: '1px solid #fecaca' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>Key Risks</div>
                      {narrative && <div style={{ fontSize: 12, color: '#991b1b', padding: '3px 0', marginBottom: 4, fontStyle: 'italic' }}>{narrative}</div>}
                      {keyRisks.map((f, i) => <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '3px 0' }}>- {f}</div>)}
                      {recommendations.map((r, i) => <div key={`r${i}`} style={{ fontSize: 12, color: '#991b1b', padding: '3px 0' }}>- {r}</div>)}
                    </div>
                  )}
                  {conditions.length > 0 && (
                    <div className="risk-card card-entrance" style={{ background: '#ecfdf5', borderRadius: 12, padding: 14, border: '1px solid #a7f3d0', animationDelay: '0.1s' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', marginBottom: 6 }}>Conditions for Approval</div>
                      {conditions.map((c, i) => <div key={i} style={{ fontSize: 12, color: '#065f46', padding: '3px 0' }}>- {c}</div>)}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Cross-profile comparison */}
            <div className="cross-profile-section" style={{ ...cardStyle, padding: 20, marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>Same Transaction, Different Organizations</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>How the GU cost shifts by organizational risk appetite</p>

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

            <div className="start-new-btn no-print" style={{ textAlign: 'center' }}>
              <button onClick={reset} className="btn-interactive" style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', background: theme === 'dark' ? 'var(--accent-primary)' : '#1e293b', color: '#fff', fontSize: 13, fontWeight: 700, boxShadow: 'var(--shadow-md)' }}>Start New Analysis</button>
            </div>

            {/* Print footer */}
            <div className="print-only print-footer" style={{ display: 'none' }}>
              Generated by GU Engine v2 | {new Date().toLocaleDateString()} | Confidential
            </div>
          </div>
        );
      })()}

      {/* Input area */}
      {!result && (
        <div className="input-area no-print">
          {file && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--accent-primary-light)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)' }}>
                {file.name}
                <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-secondary)', fontSize: 14, fontWeight: 700, padding: 0 }}>x</button>
              </div>
            </div>
          )}
          <div className="input-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={e => { setFile(e.target.files[0] || null); e.target.value = ''; }} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} className="btn-interactive" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontSize: 16, color: 'var(--text-tertiary)', minHeight: 44 }}>{'\uD83D\uDCCE'}</button>
            <textarea
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              placeholder={active ? "Answer the advisor's questions..." : 'Paste contract text or describe a transaction...'}
              rows={active ? 2 : 4}
              style={{
                flex: 1, padding: 12, borderRadius: 10, border: '1.5px solid var(--border-primary)',
                fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', resize: 'vertical',
                fontFamily: 'inherit', outline: 'none', minHeight: active ? 44 : 90,
                background: 'var(--bg-input)', transition: 'border-color 0.3s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--border-focus)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-primary)'}
            />
            <button onClick={() => send()} disabled={loading || (!input.trim() && !file)} className="btn-interactive" style={{
              padding: '12px 22px', borderRadius: 10, border: 'none', cursor: loading ? 'wait' : 'pointer',
              background: loading ? 'var(--text-muted)' : 'linear-gradient(135deg,#4338ca,#6366f1)', color: '#fff',
              fontSize: 13, fontWeight: 700, minHeight: 44, opacity: (!input.trim() && !file) ? 0.5 : 1,
              boxShadow: loading ? 'none' : 'var(--shadow-accent)',
              transition: 'all 0.3s',
            }}>{loading ? 'Analyzing...' : active ? 'Send' : 'Analyze'}</button>
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
