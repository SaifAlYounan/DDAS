import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { DEFAULT_CONFIG } from './config';
import ContractAnalyzer from './components/ContractAnalyzer';
import GUCalculator from './components/GUCalculator';
import ConfigPanel from './components/ConfigPanel';

// Theme context
const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

// History context
const HistoryContext = createContext();
export const useHistory = () => useContext(HistoryContext);

const MAX_HISTORY = 20;

function ThemeToggle({ theme, toggle }) {
  return (
    <button
      onClick={toggle}
      className="theme-toggle btn-interactive"
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      style={{
        padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--border-primary)',
        background: 'var(--bg-card)', cursor: 'pointer', fontSize: 16,
        display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.3s',
        color: 'var(--text-secondary)',
      }}
    >
      {theme === 'light' ? '\u{1F319}' : '\u{2600}\u{FE0F}'}
      <span style={{ fontSize: 11, fontWeight: 600 }}>{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

function OnboardingOverlay({ onDismiss }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: '🎯', title: 'Score Risk', desc: 'Assess contracts across 6 risk dimensions — financial, reversibility, regulatory, reputational, precedent, and complexity.' },
    { icon: '🤖', title: 'AI Analysis', desc: 'Upload or paste a contract and let Claude AI identify red flags, missing provisions, and score each dimension with rationale.' },
    { icon: '⚙️', title: 'Configure', desc: 'Customize weights, tier boundaries, and scoring anchors to match your organization\'s risk appetite.' },
  ];

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: 8 }}>Welcome to</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Dynamic Delegation of Authority System</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Dynamic, AI-powered risk scoring in 3 steps</p>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          {steps.map((s, i) => (
            <div key={i} onClick={() => setStep(i)} style={{
              flex: 1, padding: 16, borderRadius: 12, cursor: 'pointer',
              background: i === step ? 'var(--accent-primary-light)' : 'var(--bg-tertiary)',
              border: `2px solid ${i === step ? 'var(--accent-primary)' : 'transparent'}`,
              textAlign: 'center', transition: 'all 0.3s',
              transform: i === step ? 'scale(1.03)' : 'scale(1)',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: i === step ? 'var(--accent-primary)' : 'var(--text-secondary)', marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 20 : 8, height: 8, borderRadius: 4,
                background: i === step ? 'var(--accent-primary)' : 'var(--border-primary)',
                transition: 'all 0.3s',
              }} />
            ))}
          </div>
          <button onClick={onDismiss} className="btn-interactive" style={{
            padding: '10px 28px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'var(--accent-primary)', color: '#fff', fontSize: 14, fontWeight: 700,
            boxShadow: 'var(--shadow-accent)',
          }}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}

function CorporateHeader({ theme, toggleTheme, history, onHistoryOpen, onAbout }) {
  const navyBg = theme === 'dark' ? '#1a2f4a' : '#0f2644';
  const navyBorder = theme === 'dark' ? '#22405f' : '#0c1e38';
  return (
    <div className="hero-section no-print" style={{
      background: navyBg,
      borderRadius: 12,
      marginBottom: 20,
      border: `1px solid ${navyBorder}`,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px' }}>
        {/* Logo + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 8,
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 2L3 5.5V11C3 15.4 6.6 19.5 11 21C15.4 19.5 19 15.4 19 11V5.5L11 2Z"
                stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" fill="rgba(255,255,255,0.08)" />
              <path d="M7.5 11L9.5 13L14.5 8.5"
                stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2.5, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', lineHeight: 1 }}>
              DDAS — Internal Governance Tool
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', marginTop: 4, letterSpacing: 0.2 }}>
              Dynamic Delegation of Authority System
            </div>
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.45)', padding: '3px 8px',
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: 3,
          }}>
            Confidential — Internal Use
          </span>
          {onAbout && (
            <button
              onClick={onAbout}
              className="btn-interactive"
              title="About this system"
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                color: 'rgba(255,255,255,0.8)',
              }}
            >
              About
            </button>
          )}
          <button
            onClick={onHistoryOpen}
            className="btn-interactive"
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            History
            {history.length > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#0f2644', background: 'rgba(255,255,255,0.9)',
                borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center',
              }}>{history.length}</span>
            )}
          </button>
          <button
            onClick={toggleTheme}
            className="btn-interactive"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              color: 'rgba(255,255,255,0.8)',
            }}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryDrawer({ history, onSelect, onClear, isOpen, onClose }) {
  if (!isOpen) return null;
  const tiers = DEFAULT_CONFIG.tiers;
  const getTier = (gu) => tiers.find(t => gu <= t.maxGU) || tiers[tiers.length - 1];

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'var(--overlay-bg)', zIndex: 998,
      }} />
      <div className="history-drawer slide-in-right" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '90vw',
        background: 'var(--bg-secondary)', zIndex: 999, boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border-primary)',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Analysis History</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{history.length} of {MAX_HISTORY} entries</div>
          </div>
          <button onClick={onClose} className="btn-interactive" style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-primary)',
            background: 'var(--bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)',
          }}>X</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 13 }}>No analyses yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Completed analyses will appear here.</div>
            </div>
          ) : (
            history.map((entry, i) => {
              const tier = getTier(entry.gu);
              return (
                <button key={entry.id} onClick={() => { onSelect(entry); onClose(); }} className="card-entrance btn-interactive" style={{
                  width: '100%', padding: 12, marginBottom: 8, borderRadius: 10,
                  border: '1px solid var(--border-primary)', background: 'var(--bg-card)',
                  cursor: 'pointer', textAlign: 'left',
                  animationDelay: `${i * 0.05}s`, animationFillMode: 'backwards',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: tier.color }}>{entry.gu} <span style={{ fontSize: 11, fontWeight: 600 }}>GU</span></span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: tier.color, padding: '2px 6px', background: tier.bg, borderRadius: 4, border: `1px solid ${tier.border}` }}>{tier.name}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {entry.summary}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.type}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {history.length > 0 && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-primary)' }}>
            <button onClick={onClear} className="btn-interactive" style={{
              width: '100%', padding: '8px 14px', borderRadius: 8,
              border: '1.5px solid #fecaca', background: 'var(--bg-card)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#ef4444',
            }}>Clear All History</button>
          </div>
        )}
      </div>
    </>
  );
}

const WHY_IT_MATTERS = [
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    text: 'A simple routine contract doesn\'t need C-suite sign-off. A complex JV with regulatory exposure does. Your current DoA most likely can\'t tell the difference.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
      </svg>
    ),
    text: 'This isn\'t a tool that supplements your DoA. It replaces it with something smarter — governance that adapts to what\'s actually in front of you.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
    text: 'Built on Board-approved risk appetite and AI-powered analysis — not arbitrary dollar thresholds that made sense when your company was half the size.',
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    text: 'Fully confidential. Nothing is stored at the app level. Your contracts and transaction details stay private.',
  },
];

const METHODOLOGY_SECTIONS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
    label: '01 — The Problem',
    title: 'The Problem with Traditional DoAs',
    body: 'A Delegation of Authority table is a static lookup: action type → dollar threshold → approver. It treats a routine $500K equipment replacement the same as a $500K investment in an untested market. The procedural cost is identical, even though the risk profiles are completely different. This leads to two failure modes: over-governance of routine matters (slowing the organization), and under-governance of novel risks that happen to fall below a dollar threshold.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
        <line x1="12" y1="2" x2="12" y2="22"/>
        <line x1="2" y1="8.5" x2="22" y2="8.5"/>
        <line x1="2" y1="15.5" x2="22" y2="15.5"/>
      </svg>
    ),
    label: '02 — The Model',
    title: 'The GU Model',
    body: 'Instead of mapping actions to approvers, we map risk profiles to a single scalar: Governance Units. The GU cost is a weighted composite of multiple risk dimensions — financial exposure, reversibility, regulatory complexity, reputational impact, precedent-setting nature, and stakeholder complexity. The weights are tunable per organization type. A regulated bank will weight compliance risk higher; a startup will weight financial exposure and speed.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
    label: '03 — The Algorithm',
    title: 'From Table to Algorithm',
    body: 'The traditional DoA is a lookup table maintained in a policy document. The GU model is an algorithm that can be embedded in any workflow system. When someone initiates a purchase order, contract, or investment, the system scores the risk dimensions (some automatically from metadata, some via a short questionnaire) and computes the GU cost. The approval pathway is determined dynamically. No table to maintain. No ambiguity about which row applies.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
    label: '04 — AI Integration',
    title: 'Where AI Comes In',
    body: "AI can auto-score several dimensions by analyzing transaction metadata: financial exposure from the amount, regulatory risk from contract clauses or counterparty jurisdiction, precedent from historical transaction matching, and stakeholder complexity from org-chart analysis. The human only validates or adjusts the AI's assessment, reducing friction on routine transactions to near-zero while ensuring novel risks get the scrutiny they deserve.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    ),
    label: '05 — Calibration',
    title: 'Continuous Calibration',
    body: "Unlike a static DoA that's reviewed annually, a GU model can learn. If transactions scored at 25 GU consistently require no escalation beyond manager review, the tier boundaries can be adjusted. If a class of transactions scored low later turns out to cause problems, the weighting model can be retrained. The governance framework becomes a living system.",
  },
];

function WhyUseful() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>

      {/* Page header card */}
      <div style={{
        padding: '24px 28px', marginBottom: 20,
        background: 'var(--bg-card)', borderRadius: 12,
        border: '1px solid var(--border-primary)', borderLeft: '5px solid #0f2644',
        boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 10 }}>
          Methodology · Whitepaper
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', lineHeight: 1.3, letterSpacing: -0.3 }}>
          Why a Dynamic Delegation of Authority?
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.75, margin: 0 }}>
          A technical overview of the GU scoring model — from the limitations of traditional DoA frameworks to a risk-weighted, AI-assisted governance algorithm.
        </p>
      </div>

      {/* Sections */}
      <div style={{
        background: 'var(--bg-card)', borderRadius: 12,
        border: '1px solid var(--border-primary)',
        boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
        overflow: 'hidden',
      }}>
        {METHODOLOGY_SECTIONS.map((s, i) => (
          <div key={i} className="card-entrance" style={{
            padding: '28px 32px',
            borderBottom: i < METHODOLOGY_SECTIONS.length - 1 ? '1px solid var(--border-secondary)' : 'none',
            animationDelay: `${i * 0.06}s`, animationFillMode: 'backwards',
          }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {/* Icon + label column */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 11,
                  background: 'rgba(30,74,122,0.08)', border: '1px solid rgba(30,74,122,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#1e4a7a',
                }}>
                  {s.icon}
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
                  color: '#5b8fbe', writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                  opacity: 0.7,
                }}>{s.label.split(' — ')[0]}</span>
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 7 }}>
                  {s.label}
                </div>
                <h2 style={{
                  fontSize: 17, fontWeight: 800, color: 'var(--text-primary)',
                  margin: '0 0 14px', lineHeight: 1.35,
                }}>
                  {s.title}
                </h2>
                <p style={{
                  fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.85,
                  margin: 0,
                }}>
                  {s.body}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: 16, padding: '14px 20px', borderRadius: 10,
        background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.65,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Note:</strong> Configuration parameters — dimension weights, tier thresholds, and scoring anchors — are fully adjustable in the <em>Configuration</em> tab to match your organization's risk appetite.
      </div>
    </div>
  );
}

function HowItWorks({ onGetStarted }) {
  const cardBase = {
    background: 'var(--bg-card)', borderRadius: 12,
    border: '1px solid var(--border-primary)',
    boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>

      {/* Hero headline */}
      <div className="card-entrance" style={{
        ...cardBase, borderLeft: '5px solid #0f2644',
        padding: '32px 36px', marginBottom: 16, animationDelay: '0s', animationFillMode: 'backwards',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 14 }}>
          DoA Governance · AI-Powered
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 6px', lineHeight: 1.2, letterSpacing: -0.4 }}>
          Your Delegation of Authority Matrix
        </h1>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0f2644', margin: '0 0 20px', lineHeight: 1.2, letterSpacing: -0.4 }}>
          is so 1999.
        </h1>
        <p style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, borderTop: '1px solid var(--border-secondary)', paddingTop: 18 }}>
          This system replaces it — with governance proportional to what's actually in front of you.
        </p>
      </div>

      {/* The Problem */}
      <div className="card-entrance" style={{
        ...cardBase, borderLeft: '4px solid #1e4a7a',
        padding: '22px 28px', marginBottom: 14, animationDelay: '0.07s', animationFillMode: 'backwards',
        display: 'flex', gap: 18,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: 'rgba(30,74,122,0.08)', border: '1px solid rgba(30,74,122,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e4a7a',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 8 }}>The Problem</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.85, margin: 0 }}>
            Every company has a Delegation of Authority — a static PDF or spreadsheet that says who can endorse and approve what, up to what dollar amount. That document was written years ago. It doesn't account for today's world, contract complexity, or the actual risk profile of each transaction. A $50M routine equipment purchase and a $50M risky joint venture get the <strong>same approval path</strong>. They pay the same bureaucratic price to get approved. That's broken.
          </p>
        </div>
      </div>

      {/* What This Does */}
      <div className="card-entrance" style={{
        ...cardBase, borderLeft: '4px solid #1e4a7a',
        padding: '22px 28px', marginBottom: 14, animationDelay: '0.14s', animationFillMode: 'backwards',
        display: 'flex', gap: 18,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: 'rgba(30,74,122,0.08)', border: '1px solid rgba(30,74,122,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e4a7a',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 8 }}>What This Does</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.85, margin: 0 }}>
            The Governance Utility Engine reads your actual action description or contract, scores its complexity across multiple dimensions — financial exposure, regulatory risk, operational dependency, strategic impact — and generates a dynamic governance recommendation: <strong>who should review it, at what level, and why</strong>. No more one-size-fits-all matrices. Every contract gets governance proportional to its actual risk.
          </p>
        </div>
      </div>

      {/* Why It Matters */}
      <div className="card-entrance" style={{
        ...cardBase, padding: '22px 28px', marginBottom: 24, animationDelay: '0.21s', animationFillMode: 'backwards',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 16 }}>Why It Matters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
          {WHY_IT_MATTERS.map((item, i) => (
            <div key={i} className="card-entrance" style={{
              display: 'flex', gap: 12, padding: '12px 14px',
              background: 'rgba(30,74,122,0.04)', borderRadius: 9,
              border: '1px solid rgba(30,74,122,0.1)',
              animationDelay: `${0.21 + i * 0.06}s`, animationFillMode: 'backwards',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0, marginTop: 1,
                background: 'rgba(30,74,122,0.1)', border: '1px solid rgba(30,74,122,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e4a7a',
              }}>
                {item.icon}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.75, margin: 0 }}>
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      {onGetStarted && (
        <div className="card-entrance" style={{
          ...cardBase, padding: '28px 36px', textAlign: 'center',
          background: 'linear-gradient(135deg, #0f2644 0%, #1e4a7a 100%)',
          border: '1px solid #0c1e38', animationDelay: '0.42s', animationFillMode: 'backwards',
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
            Ready to get started?
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>
            Try It Now
          </h2>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 24px', lineHeight: 1.6 }}>
            Upload a contract, paste a transaction description, or use our demo settlement agreement.
          </p>
          <button
            onClick={onGetStarted}
            className="btn-interactive"
            style={{
              padding: '14px 48px', borderRadius: 10, border: '2px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.12)', color: '#fff', backdropFilter: 'blur(4px)',
              fontSize: 15, fontWeight: 800, letterSpacing: 0.3, cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.22)'; e.target.style.borderColor = 'rgba(255,255,255,0.6)'; }}
            onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.12)'; e.target.style.borderColor = 'rgba(255,255,255,0.3)'; }}
          >
            Get Started →
          </button>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              Fully confidential — nothing is stored at the app level
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState(() =>
    sessionStorage.getItem('gu-engine-onboarded') ? 'analyzer' : 'landing'
  );
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  // Theme state
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('gu-engine-theme') || 'light';
  });

  // History state
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gu-engine-history') || '[]');
    } catch { return []; }
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoredResult, setRestoredResult] = useState(null);

  const handleGetStarted = useCallback(() => {
    sessionStorage.setItem('gu-engine-onboarded', 'true');
    setView('analyzer');
  }, []);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('gu-engine-theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  }, []);

  // Sync theme to HTML
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Persist history
  useEffect(() => {
    localStorage.setItem('gu-engine-history', JSON.stringify(history));
  }, [history]);

  const addToHistory = useCallback((entry) => {
    setHistory(prev => {
      const next = [{ ...entry, id: Date.now(), timestamp: new Date().toISOString() }, ...prev];
      return next.slice(0, MAX_HISTORY);
    });
  }, []);

  const clearHistory = useCallback(() => {
    if (confirm('Clear all analysis history?')) {
      setHistory([]);
    }
  }, []);

  const onHistorySelect = useCallback((entry) => {
    setRestoredResult(entry.fullResult);
    setView('analyzer');
  }, []);

  const secondaryTools = [
    { id: 'calculator', label: 'Manual Calculator', icon: '🧮' },
    { id: 'config', label: 'Configuration', icon: '⚙️' },
    { id: 'why', label: 'Why is this useful?', icon: '💡' },
  ];

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <HistoryContext.Provider value={{ history, addToHistory, clearHistory }}>
        <div className="app-container" style={{ maxWidth: 980, margin: '0 auto', padding: '20px 14px', minHeight: '100vh' }}>

          {/* Corporate header */}
          <CorporateHeader
            theme={theme}
            toggleTheme={toggleTheme}
            history={history}
            onHistoryOpen={() => setHistoryOpen(true)}
            onAbout={view !== 'landing' ? () => setView('landing') : null}
          />

          {/* Landing page — no tab bar */}
          {view === 'landing' && (
            <div key="landing" className="tab-content-enter">
              <HowItWorks onGetStarted={handleGetStarted} />
            </div>
          )}

          {/* Navigation strip — hidden on landing */}
          {view !== 'landing' && (
            <div className="no-print" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bg-card)', borderRadius: 10,
              border: '1px solid var(--border-primary)',
              marginBottom: 24, padding: '0 6px 0 0',
              boxShadow: '0 1px 4px rgba(15,38,68,0.07)',
              flexWrap: 'wrap', gap: 0, overflow: 'hidden',
            }}>
              {/* Primary: AI Contract Scorer */}
              <button
                onClick={() => { setView('analyzer'); setRestoredResult(null); }}
                className="btn-interactive"
                style={{
                  padding: '12px 20px', background: 'transparent', cursor: 'pointer',
                  border: 'none',
                  borderBottom: view === 'analyzer' ? '3px solid var(--accent-primary)' : '3px solid transparent',
                  borderRight: '1px solid var(--border-primary)',
                  color: view === 'analyzer' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontSize: 14, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ fontSize: 16 }}>📄</span>
                AI Contract Scorer
              </button>

              {/* Divider label */}
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
                color: 'var(--text-muted)', padding: '0 14px', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                Resources
              </span>

              {/* Secondary tools: small ghost buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {secondaryTools.map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => { setView(tool.id); setRestoredResult(null); }}
                    className="btn-interactive"
                    style={{
                      padding: '8px 13px', background: 'transparent', cursor: 'pointer',
                      border: 'none',
                      borderBottom: view === tool.id ? '3px solid var(--accent-primary)' : '3px solid transparent',
                      borderRadius: 0,
                      color: view === tool.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                      fontSize: 12, fontWeight: view === tool.id ? 700 : 500,
                      display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: 13, opacity: view === tool.id ? 1 : 0.7 }}>{tool.icon}</span>
                    {tool.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content with tab transition */}
          {view !== 'landing' && (
            <div key={view} className="tab-content-enter">
              {view === 'analyzer' && <ContractAnalyzer config={config} restoredResult={restoredResult} onResultClear={() => setRestoredResult(null)} />}
              {view === 'calculator' && <GUCalculator config={config} />}
              {view === 'config' && <ConfigPanel config={config} setConfig={setConfig} />}
              {view === 'why' && <WhyUseful />}
            </div>
          )}

          {/* Footer */}
          <footer style={{
            textAlign: 'center', marginTop: 40, padding: '16px 0',
            borderTop: '1px solid var(--border-primary)', fontSize: 11, color: 'var(--text-muted)',
          }}>
            Dynamic Delegation of Authority System — Internal Use Only
          </footer>
        </div>

        {/* History drawer */}
        <HistoryDrawer
          history={history}
          onSelect={onHistorySelect}
          onClear={clearHistory}
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />

      </HistoryContext.Provider>
    </ThemeContext.Provider>
  );
}
