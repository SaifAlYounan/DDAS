import { useState, useMemo, useEffect, useRef } from 'react';
import { computeGU } from '../config.js';

function AnimatedGU({ value }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    const diff = value - prev;
    if (Math.abs(diff) < 0.1) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }
    const steps = 20;
    const stepSize = diff / steps;
    let current = 0;
    const interval = setInterval(() => {
      current++;
      if (current >= steps) {
        setDisplay(value);
        prevRef.current = value;
        clearInterval(interval);
      } else {
        setDisplay(Math.round((prev + stepSize * current) * 10) / 10);
      }
    }, 20);
    return () => clearInterval(interval);
  }, [value]);

  return <>{display.toFixed(1)}</>;
}

function MiniRadarPreview({ breakdown, size = 120 }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 16;
  const n = breakdown.length;

  const getPoint = (i, value) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (value / 10) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const scorePoints = breakdown.map((b, i) => getPoint(i, b.raw));
  const polygonPath = scorePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  const gridPath = [3, 6, 10].map(level => {
    const pts = breakdown.map((_, i) => getPoint(i, level));
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {gridPath.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--border-primary)" strokeWidth={0.5} opacity={0.4} />
      ))}
      {breakdown.map((_, i) => {
        const end = getPoint(i, 10);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="var(--border-primary)" strokeWidth={0.3} opacity={0.3} />;
      })}
      <path d={polygonPath} fill="var(--accent-primary)" opacity={0.15} />
      <path d={polygonPath} fill="none" stroke="var(--accent-primary)" strokeWidth={2} strokeLinejoin="round" style={{ transition: 'all 0.3s ease' }} />
      {scorePoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--accent-primary)" stroke="#fff" strokeWidth={1.5} />
      ))}
      {breakdown.map((b, i) => {
        const labelPt = getPoint(i, 13);
        return (
          <text key={i} x={labelPt.x} y={labelPt.y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 7, fontWeight: 700, fill: 'var(--text-muted)' }}>
            {b.icon}
          </text>
        );
      })}
    </svg>
  );
}

function BeforeAfterComparison() {
  const doaRows = [
    { amount: '< $10K', approver: 'Manager', time: '~1 day' },
    { amount: '$10K - $100K', approver: 'Director', time: '~3 days' },
    { amount: '$100K - $1M', approver: 'VP', time: '~5 days' },
    { amount: '$1M - $10M', approver: 'CFO', time: '~10 days' },
    { amount: '> $10M', approver: 'Board', time: 'Board cycle' },
  ];

  const guDimensions = [
    { icon: '💰', label: 'Financial', desc: 'Value at risk' },
    { icon: '🔄', label: 'Reversibility', desc: 'Can it be undone?' },
    { icon: '⚖️', label: 'Regulatory', desc: 'Compliance exposure' },
    { icon: '📢', label: 'Reputational', desc: 'Brand impact' },
    { icon: '📐', label: 'Precedent', desc: 'Sets new pattern?' },
    { icon: '🕸️', label: 'Complexity', desc: 'Stakeholder web' },
  ];

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-primary)',
      padding: 20, marginTop: 24, marginBottom: 8,
    }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', textAlign: 'center' }}>Why DDAS?</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 16px' }}>
        From one-dimensional dollar thresholds to multidimensional risk intelligence
      </p>

      <div className="comparison-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
          <div style={{ padding: '10px 14px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>📋</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Traditional DoA</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: '#ef4444', padding: '1px 6px', background: '#fef2f2', borderRadius: 3 }}>STATIC</span>
          </div>
          <div style={{ padding: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-secondary)' }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-secondary)' }}>Approver</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-secondary)' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {doaRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '5px 8px', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-secondary)' }}>{r.amount}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-secondary)' }}>{r.approver}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', textAlign: 'right', borderBottom: '1px solid var(--border-secondary)' }}>{r.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: '#ef4444', fontStyle: 'italic' }}>
              Only considers dollar amount
            </div>
          </div>
        </div>

        <div style={{ borderRadius: 10, overflow: 'hidden', border: '2px solid var(--accent-primary)' }}>
          <div style={{ padding: '10px 14px', background: 'var(--accent-primary-light)', borderBottom: '1px solid var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>🤖</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>DDAS</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: '#059669', padding: '1px 6px', background: '#ecfdf5', borderRadius: 3 }}>DYNAMIC</span>
          </div>
          <div style={{ padding: 10 }}>
            {guDimensions.map((d, i) => (
              <div key={i} className="card-entrance" style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                borderBottom: i < guDimensions.length - 1 ? '1px solid var(--border-secondary)' : 'none',
                animationDelay: `${i * 0.06}s`, animationFillMode: 'backwards',
              }}>
                <span style={{ fontSize: 14 }}>{d.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', flex: 1 }}>{d.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.desc}</span>
              </div>
            ))}
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: '#059669', fontWeight: 600 }}>
              Weighted, multi-dimensional, AI-scored
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GUCalculator({ config }) {
  const dimensions = Object.entries(config.anchors).map(([id, anchor]) => ({ id, ...anchor }));

  const initialSelections = Object.fromEntries(dimensions.map(d => [d.id, 0]));
  const [selections, setSelections] = useState(initialSelections);
  const [profileId, setProfileId] = useState('default');

  const { gu, tier, breakdown, floorApplied } = useMemo(() => {
    const scores = Object.fromEntries(
      dimensions.map(d => [d.id, d.points[selections[d.id]].score])
    );
    const result = computeGU(scores, config, profileId);
    const bd = dimensions.map(d => ({
      id: d.id,
      label: d.label,
      icon: d.icon,
      raw: scores[d.id],
      weight: config.profiles[profileId].weights[d.id],
      weighted: scores[d.id] * config.profiles[profileId].weights[d.id] * 10,
    }));
    return { gu: result.gu, tier: result.tier, tierIndex: result.tierIndex, breakdown: bd, floorApplied: result.floorApplied };
  }, [selections, profileId, config]);

  const cardStyle = {
    background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-primary)',
    boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20, padding: '16px 20px', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-primary)', borderLeft: '4px solid #1e4a7a', boxShadow: '0 1px 4px rgba(15,38,68,0.07)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(30,74,122,0.08)', border: '1px solid rgba(30,74,122,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e4a7a', flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>🧮 Manual Calculator</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>Select risk levels for each dimension to compute your score and required approval tier. Uses the same engine as the AI analyser.</p>
        </div>
      </div>

      {/* Weight Profile Selector */}
      <div style={{
        ...cardStyle, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        flexWrap: 'wrap', padding: '16px 20px',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Organisation profile:</span>
        {Object.entries(config.profiles).map(([id, profile]) => (
          <button key={id} onClick={() => setProfileId(id)} className="btn-interactive" style={{
            padding: '6px 14px', borderRadius: 6,
            border: profileId === id ? '2px solid var(--accent-primary)' : '1.5px solid var(--border-primary)',
            background: profileId === id ? 'var(--accent-primary-light)' : 'var(--bg-card)', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            color: profileId === id ? 'var(--accent-primary)' : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>{profile.label}</button>
        ))}
      </div>

      {/* Risk Dimensions — driven from config.anchors */}
      {dimensions.map((dim, dimIdx) => (
        <div key={dim.id} className="card-entrance" style={{
          ...cardStyle, marginBottom: 16, padding: '16px 20px',
          animationDelay: `${dimIdx * 0.05}s`, animationFillMode: 'backwards',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>{dim.icon}</span>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{dim.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{dim.description}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {dim.points.map((point, i) => {
              const active = i === selections[dim.id];
              const hue = [142, 120, 45, 25, 0][Math.min(i, 4)];
              return (
                <button key={i} onClick={() => setSelections(prev => ({ ...prev, [dim.id]: i }))} className="score-btn" style={{
                  flex: '1 1 0', minWidth: 100, padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                  border: active ? `2px solid hsl(${hue}, 70%, 45%)` : '1.5px solid var(--border-primary)',
                  background: active ? `hsl(${hue}, 80%, 96%)` : 'var(--bg-card)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  boxShadow: active ? `0 2px 8px hsla(${hue}, 70%, 45%, 0.2)` : 'none',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: active ? `hsl(${hue}, 70%, 35%)` : 'var(--text-secondary)', transition: 'color 0.3s' }}>{point.label}</span>
                  <span style={{ fontSize: 11, color: active ? `hsl(${hue}, 60%, 40%)` : 'var(--text-muted)', textAlign: 'center', transition: 'color 0.3s' }}>{point.description}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: active ? `hsl(${hue}, 70%, 40%)` : 'var(--border-primary)', transition: 'color 0.3s' }}>
                    Score: {point.score}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Floor Rule Override Notice */}
      {floorApplied && (
        <div className="card-entrance" style={{
          marginBottom: 16, padding: 14, borderRadius: 12,
          background: '#fef2f2', border: '1px solid #fecaca',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>
            ⚠️ Floor Rule Applied — Tier Upgraded
          </div>
          <div style={{ fontSize: 12, color: '#991b1b' }}>
            {floorApplied} — the approval tier has been raised to <strong>{tier.name}</strong> regardless of the weighted score.
          </div>
        </div>
      )}

      {/* Results Panel */}
      <div className="fade-in" style={{
        marginTop: 24, padding: 24, background: tier.bg,
        borderRadius: 16, border: `2px solid ${tier.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>Governance Score</div>
            <div style={{ fontSize: 42, fontWeight: 800, color: tier.color, lineHeight: 1.1 }}>
              <AnimatedGU value={gu} /> <span style={{ fontSize: 18, fontWeight: 600 }}>GU</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Required Tier</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: tier.color }}>{tier.name}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Balance</div>
            <MiniRadarPreview breakdown={breakdown} />
          </div>
        </div>

        {/* Gauge */}
        <div style={{ width: '100%', height: 28, background: '#f1f5f9', borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            width: `${Math.min((gu / 100) * 100, 100)}%`, height: '100%',
            background: `linear-gradient(90deg, #10b981, ${tier.color})`,
            borderRadius: 14, transition: 'width 0.5s ease',
          }} />
          <span style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            fontWeight: 700, fontSize: 13,
            color: (gu / 100) * 100 > 45 ? '#fff' : '#334155',
          }}><AnimatedGU value={gu} /> GU</span>
        </div>

        {/* Approval Details */}
        <div className="tier-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16, marginBottom: 20 }}>
          {[
            { label: 'Approver', value: tier.approver },
            { label: 'Target SLA', value: tier.sla },
            { label: 'Controls Required', value: tier.controls },
          ].map(item => (
            <div key={item.label} style={{ padding: 12, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-primary)', transition: 'all 0.3s' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* Breakdown */}
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Score Breakdown</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {[...breakdown].sort((a, b) => b.weighted - a.weighted).map((b, i) => (
            <div key={b.id} className="card-entrance" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-primary)',
              flexWrap: 'wrap', animationDelay: `${i * 0.04}s`, animationFillMode: 'backwards',
            }}>
              <span style={{ fontSize: 16 }}>{b.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', flex: 1, minWidth: 100 }}>{b.label}</span>
              <div style={{ width: 60, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${(b.weighted / 25) * 100}%`, height: '100%',
                  background: `hsl(${142 - (b.raw / 10) * 142}, 70%, 50%)`,
                  borderRadius: 3, transition: 'width 0.5s ease',
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>raw {b.raw} × {(b.weight * 100).toFixed(0)}%</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 52, textAlign: 'right' }}>{b.weighted.toFixed(1)} GU</span>
            </div>
          ))}
        </div>
      </div>

      {/* Before/After Comparison */}
      <BeforeAfterComparison />
    </div>
  );
}
