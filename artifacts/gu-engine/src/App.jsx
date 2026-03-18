import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { DEFAULT_CONFIG } from './config';
import ContractAnalyzer from './components/ContractAnalyzer';
import GUCalculator from './components/GUCalculator';
import ConfigPanel from './components/ConfigPanel';

const HistoryContext = createContext();
export const useHistory = () => useContext(HistoryContext);

const MAX_HISTORY = 20;

// ── Landing Page ─────────────────────────────────────────────────────────────

function HowItWorks({ onGetStarted, onMethodology, onML }) {
  const NAV = '#0f2644';
  const BLUE = '#3b5998';
  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const problemItems = [
    'Impossible to plan for everything in advance: some transactions end up being under-governed and some transactions end up being over-governed',
    'Same approval path for a $50M routine purchase and a $50M risky JV',
    'The bureaucratic cost / burden management has to go through to get an action approved is unrelated to the actual underlying risk',
    'Ambiguous on novel deal types that fall between categories',
  ];
  const solutionItems = [
    'Board-approved risk appetite dynamically applied to every deal',
    'Governance proportional to actual risk — not just dollar thresholds',
    'No more need to update the Delegation of Authority annually, no more friction between Management and Board.',
    'Fully confidential — nothing is stored at the application level',
  ];
  const steps = [
    { n: '1', title: 'Describe or Upload', desc: 'Paste an action description or upload a supporting document. The system extracts what it needs.' },
    { n: '2', title: 'DDAS Scores Risk', desc: <>DDAS scores 6 risk dimensions, identifies red flags, missing clauses, and precedent risk, on the basis of the <strong style={{ textDecoration: 'underline' }}>Board-approved</strong> Risk Matrix and Risk Appetite.</> },
    { n: '3', title: 'Get a Governance Decision', desc: 'Receive an instant approval tier, required signatories, and endorsing functions — with rationale.' },
  ];
  const comparison = [
    { criteria: 'Approval Basis', old: 'Dollar threshold', neu: 'Multi-dimensional risk score' },
    { criteria: 'Update Frequency', old: 'Annual policy review', neu: 'Real-time per transaction' },
    { criteria: 'Handles Novel Risks', old: 'No — falls between rows', neu: 'Yes — AI scores edge cases' },
    { criteria: 'Proportionality', old: 'None — one size fits all', neu: 'Built-in by design' },
    { criteria: 'Time to Decision', old: 'Days of routing', neu: 'Seconds' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Arial, sans-serif', color: '#1e293b' }}>

      {/* ── Top Nav ── */}
      <nav style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 56, position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 34, borderRadius: 7, background: NAV,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 10, letterSpacing: 0.5,
            padding: '0 4px',
          }}>DDAS</div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Dynamic Delegation of Authority System</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button onClick={() => scrollToSection('how-it-works')} style={{ background: 'none', border: 'none', fontSize: 14, color: '#475569', cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>How It Works</button>
          <button onClick={onGetStarted} style={{
            padding: '8px 20px', background: NAV, color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
          }}>
            Analyse a Transaction →
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={{ textAlign: 'center', padding: '72px 40px 56px', maxWidth: 780, margin: '0 auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', color: BLUE, marginBottom: 20 }}>
          DOA Governance · AI-Powered
        </div>
        <h1 style={{ fontSize: 44, fontWeight: 900, color: '#1e293b', lineHeight: 1.15, margin: '0 0 18px' }}>
          Your Delegation of Authority Matrix is{' '}
          <span style={{ color: '#3b82f6' }}>outdated.</span>
        </h1>
        <p style={{ fontSize: 17, color: '#64748b', lineHeight: 1.7, margin: '0 0 36px', maxWidth: 540, marginLeft: 'auto', marginRight: 'auto' }}>
          This system replaces it — with AI-powered governance proportional to what's actually in front of you.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onGetStarted} style={{
            padding: '13px 32px', background: NAV, color: '#fff',
            border: 'none', borderRadius: 7, fontSize: 15, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'Arial, sans-serif',
            boxShadow: '0 4px 14px rgba(15,38,68,0.3)',
          }}>
            Analyse a Transaction →
          </button>
          <button onClick={() => scrollToSection('how-it-works')} style={{
            padding: '13px 28px', background: 'transparent', color: NAV,
            border: '1.5px solid #cbd5e1', borderRadius: 7, fontSize: 15,
            fontWeight: 600, cursor: 'pointer', fontFamily: 'Arial, sans-serif',
          }}>
            Learn How It Works
          </button>
        </div>
      </div>

      {/* ── Problem / Solution ── */}
      <div style={{ maxWidth: 900, margin: '0 auto 64px', padding: '0 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Problem */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '28px 28px 24px',
          borderLeft: '4px solid #ef4444', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#ef4444', marginBottom: 12 }}>
            THE PROBLEM
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', marginBottom: 10 }}>Your DoA Is Static. Your Risk Isn't.</h3>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
            A static PDF that assigns approvers by dollar amount — which is written in the abstract.
          </p>
          {problemItems.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, fontSize: 13.5, color: '#374151', lineHeight: 1.55 }}>
              <span style={{ color: '#ef4444', fontSize: 15, flexShrink: 0, marginTop: 1 }}>☐</span>
              <span>{t}</span>
            </div>
          ))}
        </div>

        {/* Solution */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '28px 28px 24px',
          borderLeft: '4px solid #10b981', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#10b981', marginBottom: 12 }}>
            THE SOLUTION
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', marginBottom: 10 }}>Dynamic, Risk-Weighted Governance</h3>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
            DDAS scores every transaction across 6 risk dimensions against the Board-approved Risk Matrix and Risk Appetite, and routes it to the right approver automatically.
          </p>
          {solutionItems.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, fontSize: 13.5, color: '#374151', lineHeight: 1.55 }}>
              <span style={{ color: '#10b981', fontSize: 15, flexShrink: 0, marginTop: 1 }}>☑</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── How It Works ── */}
      <div id="how-it-works" style={{ maxWidth: 900, margin: '0 auto 64px', padding: '0 24px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>How It Works</h2>
        <p style={{ fontSize: 15, color: '#64748b', marginBottom: 40 }}>Three steps from action description to governance decision.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%', background: NAV,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 800, fontSize: 20,
              }}>{s.n}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{s.title}</div>
              <div style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.65, textAlign: 'center' }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Comparison Table ── */}
      <div style={{ maxWidth: 900, margin: '0 auto 64px', padding: '0 24px' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, color: '#1e293b', marginBottom: 8, textAlign: 'center' }}>Static DoA vs Dynamic Governance</h2>
        <p style={{ fontSize: 15, color: '#64748b', marginBottom: 32, textAlign: 'center' }}>See exactly what changes when you move from a DoA matrix to a DDAS-based system.</p>
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div style={{ padding: '12px 20px', fontSize: 10, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>CRITERIA</div>
            <div style={{ padding: '12px 20px', fontSize: 10, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: '#ef4444', background: '#fff5f5', borderBottom: '1px solid #f1f5f9' }}>OLD WAY</div>
            <div style={{ padding: '12px 20px', fontSize: 10, fontWeight: 800, letterSpacing: 1.8, textTransform: 'uppercase', color: '#10b981', background: '#f0fdf4', borderBottom: '1px solid #f1f5f9' }}>NEW WAY</div>
          </div>
          {comparison.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: i < comparison.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ padding: '13px 20px', fontSize: 13.5, color: '#475569', fontWeight: 600 }}>{row.criteria}</div>
              <div style={{ padding: '13px 20px', fontSize: 13.5, color: '#64748b' }}>{row.old}</div>
              <div style={{ padding: '13px 20px', fontSize: 13.5, color: '#047857', fontWeight: 500 }}>{row.neu}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom CTA ── */}
      <div style={{ maxWidth: 900, margin: '0 auto 64px', padding: '0 24px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0f2644 0%, #1e4a7a 100%)', borderRadius: 14, padding: '52px 48px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 12 }}>Ready to Try It?</h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', marginBottom: 32, lineHeight: 1.65 }}>
            Describe an action or upload a supporting document, or run our built-in demo.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={onGetStarted} style={{
              padding: '13px 32px', background: '#fff', color: NAV,
              border: 'none', borderRadius: 7, fontSize: 15, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'Arial, sans-serif',
            }}>
              Analyse a Transaction →
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── History Drawer ────────────────────────────────────────────────────────────

function HistoryDrawer({ history, onSelect, onClear, isOpen, onClose }) {
  const [clearConfirm, setClearConfirm] = useState(false);
  useEffect(() => {
    if (!isOpen) setClearConfirm(false);
  }, [isOpen]);
  if (!isOpen) return null;
  const tiers = DEFAULT_CONFIG.tiers;
  const getTier = (gu) => tiers.find(t => gu <= t.maxGU) || tiers[tiers.length - 1];

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 998 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '90vw',
        background: '#fff', zIndex: 999, boxShadow: '0 0 32px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0',
        fontFamily: 'Arial, sans-serif',
      }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Analysis History</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{history.length} of {MAX_HISTORY} entries</div>
          </div>
          <button onClick={onClose} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 14, color: '#64748b', fontFamily: 'Arial, sans-serif' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
              <div style={{ fontSize: 13 }}>No analyses yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Completed analyses will appear here.</div>
            </div>
          ) : (
            history.map((entry, i) => {
              const tier = getTier(entry.gu);
              return (
                <button key={entry.id} onClick={() => { onSelect(entry); onClose(); }} style={{
                  width: '100%', padding: 12, marginBottom: 8, borderRadius: 10,
                  border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'Arial, sans-serif',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: tier.color }}>{entry.gu} <span style={{ fontSize: 11, fontWeight: 600 }}>GU</span></span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: tier.color, padding: '2px 6px', background: tier.bg, borderRadius: 4, border: `1px solid ${tier.border}` }}>{tier.name}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', lineHeight: 1.4, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {entry.summary}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>{entry.type}</span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>{new Date(entry.timestamp).toLocaleDateString()} {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
        {history.length > 0 && (
          <div style={{ padding: 12, borderTop: '1px solid #f1f5f9' }}>
            {clearConfirm ? (
              <div style={{ borderRadius: 8, border: '1.5px solid #fecaca', background: '#fff7f7', padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: '#991b1b', fontWeight: 600, marginBottom: 8, fontFamily: 'Arial, sans-serif' }}>Are you sure? This cannot be undone.</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { onClear(); setClearConfirm(false); onClose(); }} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Arial, sans-serif' }}>Yes, clear all</button>
                  <button onClick={() => setClearConfirm(false)} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#475569', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Arial, sans-serif' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setClearConfirm(true)} style={{ width: '100%', padding: '8px 14px', borderRadius: 8, border: '1.5px solid #fecaca', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#ef4444', fontFamily: 'Arial, sans-serif' }}>
                Clear All History
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Methodology page ──────────────────────────────────────────────────────────

const METHODOLOGY_SECTIONS = [
  { label: '01 — The Problem', title: 'The Problem with Traditional DoAs', body: 'A Delegation of Authority table is a static lookup: action type → dollar threshold → approver. It treats a routine $500K equipment replacement the same as a $500K investment in an untested market. The procedural cost is identical, even though the risk profiles are completely different. This leads to two failure modes: over-governance of routine matters (slowing the organization), and under-governance of novel risks that happen to fall below a dollar threshold.' },
  { label: '02 — The Model', title: 'The DDAS Model', body: 'Instead of mapping actions to approvers, we map risk profiles to a single scalar: Governance Units. The governance cost is a weighted composite of multiple risk dimensions — financial exposure, reversibility, regulatory complexity, reputational impact, precedent-setting nature, and stakeholder complexity. The weights are tunable per organization type. A regulated bank will weight compliance risk higher; a startup will weight financial exposure and speed.' },
  { label: '03 — The Algorithm', title: 'From Table to Algorithm', body: 'The traditional DoA is a lookup table maintained in a policy document. The DDAS model is an algorithm that can be embedded in any workflow system. When someone initiates a purchase order, contract, or investment, the system scores the risk dimensions and computes the governance cost. The approval pathway is determined dynamically. No table to maintain. No ambiguity about which row applies.' },
  { label: '04 — AI Integration', title: 'Where AI Comes In', body: "AI can auto-score several dimensions by analyzing transaction metadata: financial exposure from the amount, regulatory risk from contract clauses or counterparty jurisdiction, precedent from historical transaction matching, and stakeholder complexity from org-chart analysis. The human only validates or adjusts the AI's assessment, reducing friction on routine transactions to near-zero while ensuring novel risks get the scrutiny they deserve." },
  { label: '05 — Calibration', title: 'Continuous Calibration', body: "Unlike a static DoA that's reviewed annually, a DDAS model can learn. If transactions scored at 25 consistently require no escalation beyond manager review, the tier boundaries can be adjusted. If a class of transactions scored low later turns out to cause problems, the weighting model can be retrained. The governance framework becomes a living system." },
];

function WhyUseful({ setView }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ padding: '20px 24px', marginBottom: 18, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', borderLeft: '5px solid #0f2644', boxShadow: '0 1px 4px rgba(15,38,68,0.07)' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 10 }}>Concept · Whitepaper</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 10px' }}>Why a Dynamic Delegation of Authority?</h1>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.75, margin: 0 }}>A technical overview of the DDAS scoring model — from the limitations of traditional DoA frameworks to a risk-weighted, AI-assisted governance algorithm.</p>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,38,68,0.07)', overflow: 'hidden' }}>
        {METHODOLOGY_SECTIONS.map((s, i) => (
          <div key={i} style={{ padding: '26px 30px', borderBottom: i < METHODOLOGY_SECTIONS.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#5b8fbe', marginBottom: 7 }}>{s.label}</div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1e293b', margin: '0 0 12px' }}>{s.title}</h2>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.85, margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: '12px 18px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8', lineHeight: 1.65 }}>
        <strong style={{ color: '#64748b' }}>Note:</strong> Configuration parameters — dimension weights, tier thresholds, and scoring anchors — are fully adjustable in the Configuration panel to match your organization's risk appetite.
      </div>
      <div style={{ marginTop: 18, padding: '20px 24px', background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', borderLeft: '5px solid #7c3aed', boxShadow: '0 1px 4px rgba(15,38,68,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#7c3aed', marginBottom: 6 }}>Research · Roadmap</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Machine Learning</div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>Explore the roadmap for evolving DDAS from AI-assisted scoring into a continuously learning governance engine.</div>
        </div>
        <button
          onClick={() => setView('ml')}
          style={{ flexShrink: 0, padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'Arial, sans-serif', letterSpacing: 0.2, whiteSpace: 'nowrap' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#6d28d9'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#7c3aed'; }}
        >
          View Roadmap
        </button>
      </div>
    </div>
  );
}

// ── Machine Learning Roadmap ──────────────────────────────────────────────────

const ML_SECTIONS = [
  {
    label: '00 — Foundation',
    horizon: 'Today',
    title: 'The Signal You Are Already Generating',
    body: 'Every time a governance expert overrides an AI dimension score using the manual sliders, that is a labeled training example: the contract text went in, the AI produced a score, and a human with domain knowledge corrected it. This correction encodes expert judgment that the AI missed — perhaps about how UAE courts actually enforce limitation of liability clauses, or how EWEC\'s track record reduces counterparty risk for a specific off-taker. Currently, these corrections are used once and discarded. Persisting them in a structured database — document content, AI score, human-corrected score, config snapshot, timestamp — is the dataset on which every subsequent improvement depends. Without this, there is nothing to learn from.',
  },
  {
    label: '01 — Layer 1',
    horizon: 'Near-term',
    title: 'Precedent-Augmented Scoring',
    body: 'The most immediate improvement requires no model training. As scored contracts accumulate in a database, each new document can be matched against past transactions using vector embeddings — a mathematical representation of contract content. When a new settlement agreement arrives, the system retrieves the 3–5 most similar past agreements by counterparty type, jurisdiction, and financial magnitude, and injects their validated scores as examples into the prompt. This is retrieval-augmented generation applied to governance scoring. The model does not learn in the statistical sense, but the system becomes naturally consistent with its own precedent history — exactly what a legal or governance function expects. Repeatability without retraining.',
  },
  {
    label: '02 — Layer 2',
    horizon: 'Medium-term',
    title: 'Statistical Bias Correction',
    body: 'Once several hundred human-override pairs have accumulated, systematic patterns emerge: the AI may consistently underestimate financial exposure for carbon credit offtake agreements, or overestimate regulatory complexity for contracts governed by DIFC law. A lightweight regression model — not deep learning, a gradient-boosted tree — can learn these correction offsets per contract type, jurisdiction, and financial band, and apply them silently as a post-processing layer before results are shown. Drift detection can also run continuously: if the distribution of financial exposure scores begins shifting (everything clustering at 4–6 when deal sizes are increasing), an alert flags that recalibration is needed. The governance framework stays current without manual intervention.',
  },
  {
    label: '03 — Layer 3',
    horizon: 'Medium-term',
    title: 'Fine-Tuning a Dedicated Scoring Model',
    body: 'At 300–500 validated (contract text → 6-dimension score) pairs, fine-tuning a smaller open-source model becomes viable. A fine-tuned Llama or Mistral model trained specifically on this governance scoring task would produce scores faster, at a fraction of the cost, and with substantially greater consistency than a general-purpose frontier model. More importantly, a fine-tuned model can run on private infrastructure — keeping contract documents entirely within the organisation\'s own environment, a material advantage for a governance tool handling commercially sensitive transactions. At this stage, Claude transitions from primary scorer to secondary validator, invoked only when confidence is low or the document is materially unlike anything in the training set.',
  },
  {
    label: '04 — Layer 4',
    horizon: 'Long-term',
    title: 'Outcome-Based Reinforcement Learning',
    body: 'The deepest learning signal is not whether the AI agreed with the expert at time of scoring — it is whether the governance tier was appropriate given what actually happened. If a Manager-tier transaction later triggered a regulatory dispute or financial loss that required Board-level intervention, that is a missed classification in the strongest possible sense. Conversely, if C-Suite approval was systematically required for transactions that consistently resolved without incident, governance is being over-applied, creating unnecessary friction. Tracking post-approval outcomes and mapping them to original governance scores creates a reinforcement signal: reward for tiers that correctly predicted risk materialisation, penalty for misclassifications. This is how the system becomes calibrated to the organisation\'s actual risk experience — not just expert intuition captured at a single point in time. The data horizon is months to years, but the calibration insight it produces is irreplaceable.',
  },
];

function MachineLearning() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '20px 24px', marginBottom: 14, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', borderLeft: '5px solid #7c3aed', boxShadow: '0 1px 4px rgba(15,38,68,0.07)' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: '#7c3aed', marginBottom: 10 }}>Research · Roadmap</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: '0 0 10px' }}>Machine Learning Roadmap for DDAS</h1>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.75, margin: 0 }}>How the Dynamic Delegation of Authority System could evolve from AI-assisted scoring to a continuously learning governance engine — grounded in real transaction outcomes and expert feedback loops.</p>
      </div>

      {/* WIP banner */}
      <div style={{ padding: '14px 18px', marginBottom: 18, background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #f59e0b', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>🔬</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#92400e', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Work in Progress — Not Yet Integrated</div>
          <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.7 }}>The capabilities described below are a research roadmap for future development. <strong>None of these features are active in the current version of DDAS.</strong> The system today uses a fixed AI model with static scoring anchors and no persistent learning mechanism. This document outlines the engineering path toward a self-improving governance system.</div>
        </div>
      </div>

      {/* Sections */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,38,68,0.07)', overflow: 'hidden' }}>
        {ML_SECTIONS.map((s, i) => {
          const horizonStyle = {
            'Today':       { bg: '#f0fdf4', color: '#166534' },
            'Near-term':   { bg: '#ecfdf5', color: '#065f46' },
            'Medium-term': { bg: '#fffbeb', color: '#92400e' },
            'Long-term':   { bg: '#fef2f2', color: '#991b1b' },
          }[s.horizon] || { bg: '#f5f3ff', color: '#5b21b6' };
          return (
            <div key={i} style={{ padding: '26px 30px', borderBottom: i < ML_SECTIONS.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7c3aed' }}>{s.label}</div>
                <div style={{ fontSize: 9, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: horizonStyle.bg, color: horizonStyle.color, letterSpacing: 0.5 }}>{s.horizon}</div>
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1e293b', margin: '0 0 12px' }}>{s.title}</h2>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.85, margin: 0 }}>{s.body}</p>
            </div>
          );
        })}
      </div>

      {/* Prerequisite footer */}
      <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 13, color: '#475569', lineHeight: 1.75 }}>
        <strong style={{ color: '#1e293b' }}>Critical prerequisite for all four layers:</strong> A persistent, centralised database of analyzed transactions — including document content, AI scores, human override values, config snapshot at time of analysis, and post-approval outcome tracking. The current version stores results only in browser local storage, which is ephemeral, device-specific, and not queryable. Moving to server-side persistent storage is the foundational first step before any machine learning pipeline can be built.
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_BG = '#0f2644';
const NAV_HOVER = '#1e3a58';
const NAV_ACTIVE = '#1a3560';

function AppSidebar({ view, setView, history, onHistoryOpen, goHome }) {
  const navItems = [
    { id: 'landing', label: 'Home', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    )},
    { id: 'analyzer', label: 'Analyse a Transaction', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    )},
    { id: 'history', label: 'History', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    ), badge: history.length > 0 ? history.length : null, action: onHistoryOpen },
    { id: 'calculator', label: 'Manual Calculator', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>
    )},
    { id: 'config', label: 'Configuration', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    )},
    { id: 'why', label: 'Concept', icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    )},
  ];

  const handleNav = (item) => {
    if (item.action) { item.action(); return; }
    setView(item.id);
  };

  return (
    <div style={{
      width: 200, flexShrink: 0, background: NAV_BG, display: 'flex',
      flexDirection: 'column', height: '100vh', overflow: 'hidden',
      fontFamily: 'Arial, sans-serif',
    }}>
      {/* Logo */}
      <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 38, height: 30, borderRadius: 6, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 10, padding: '0 3px' }}>DDAS</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>Dynamic Delegation of Authority System</div>
        </div>
      </div>

      {/* Primary nav */}
      <div style={{ padding: '10px 8px 6px' }}>
        {navItems.map(item => {
          const isActive = view === item.id;
          return (
            <button key={item.id} onClick={() => handleNav(item)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', marginBottom: 2, borderRadius: 7,
              border: 'none', cursor: 'pointer', textAlign: 'left',
              background: isActive ? NAV_ACTIVE : 'transparent',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
              fontSize: 13.5, fontFamily: 'Arial, sans-serif',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = NAV_HOVER; e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.55)'; }}
            >
              {item.icon}
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#3b82f6', color: '#fff', borderRadius: 10, padding: '1px 6px' }}>{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{ padding: '10px 8px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ padding: '0 10px', fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: 0.5 }}>
          CONFIDENTIAL — INTERNAL USE ONLY
        </div>
      </div>
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

function AppTopBar({ view, history, onHistoryOpen, onExport, hasResult }) {
  const viewLabels = {
    analyzer: 'AI Governance Scorer',
    calculator: 'Manual Calculator',
    config: 'Configuration',
    why: 'Concept',
    ml: 'Machine Learning',
  };

  return (
    <div style={{
      height: 52, background: '#fff', borderBottom: '1px solid #e5e7eb',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', flexShrink: 0, fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
        <span style={{ color: '#94a3b8' }}>Governance</span>
        <span style={{ color: '#cbd5e1' }}>/</span>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>{viewLabels[view] || view}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onHistoryOpen} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
          background: '#f8fafc', cursor: 'pointer', fontSize: 12.5,
          color: '#475569', fontFamily: 'Arial, sans-serif',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History{history.length > 0 && <span style={{ fontWeight: 700, color: '#3b82f6' }}>{history.length}</span>}
        </button>
        {hasResult && onExport && (
          <button onClick={onExport} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: '#0f2644', cursor: 'pointer', fontSize: 12.5,
            color: '#fff', fontFamily: 'Arial, sans-serif', fontWeight: 600,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export PDF
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('landing');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gu-engine-history') || '[]'); } catch { return []; }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoredResult, setRestoredResult] = useState(null);
  const [analyzerExport, setAnalyzerExport] = useState(null);
  const [analyzerHasResult, setAnalyzerHasResult] = useState(false);

  const handleGetStarted = useCallback(() => setView('analyzer'), []);
  const handleMethodology = useCallback(() => setView('why'), []);
  const handleML = useCallback(() => setView('ml'), []);

  const addToHistory = useCallback((entry) => {
    setHistory(prev => {
      const next = [entry, ...prev.filter(e => e.id !== entry.id)].slice(0, MAX_HISTORY);
      localStorage.setItem('gu-engine-history', JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem('gu-engine-history');
  }, []);

  const onHistorySelect = useCallback((entry) => {
    setRestoredResult(entry.fullResult);
    setView('analyzer');
  }, []);

  const handleSetView = useCallback((v) => {
    setView(v);
    if (v !== 'analyzer') setRestoredResult(null);
  }, []);

  // Landing page: full standalone layout
  if (view === 'landing') {
    return (
      <HistoryContext.Provider value={{ history, addToHistory, clearHistory }}>
        <HowItWorks onGetStarted={handleGetStarted} onMethodology={handleMethodology} onML={handleML} />
      </HistoryContext.Provider>
    );
  }

  // App mode: sidebar layout
  return (
    <HistoryContext.Provider value={{ history, addToHistory, clearHistory }}>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'Arial, sans-serif', background: 'var(--bg-primary)' }}>

          <AppSidebar
            view={view}
            setView={handleSetView}
            history={history}
            onHistoryOpen={() => setHistoryOpen(true)}
            goHome={() => setView('landing')}
          />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
            <AppTopBar
              view={view}
              history={history}
              onHistoryOpen={() => setHistoryOpen(true)}
              onExport={analyzerExport || undefined}
              hasResult={analyzerHasResult}
            />

            <div key={view} className="tab-content-enter" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              {view === 'analyzer' && (
                <ContractAnalyzer
                  config={config}
                  restoredResult={restoredResult}
                  onResultClear={() => setRestoredResult(null)}
                  onExportReady={(fn) => setAnalyzerExport(() => fn)}
                  onHasResult={(v) => setAnalyzerHasResult(v)}
                />
              )}
              {view === 'calculator' && <GUCalculator config={config} />}
              {view === 'config' && <ConfigPanel config={config} setConfig={setConfig} />}
              {view === 'why' && <WhyUseful setView={setView} />}
              {view === 'ml' && <MachineLearning />}
            </div>
          </div>
        </div>

        <HistoryDrawer
          history={history}
          onSelect={onHistorySelect}
          onClear={clearHistory}
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
    </HistoryContext.Provider>
  );
}
