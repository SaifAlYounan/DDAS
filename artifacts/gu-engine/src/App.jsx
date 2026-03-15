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
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Governance Unit Engine</h2>
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

function HeroSection({ theme }) {
  return (
    <div className="hero-section hero-glow" style={{
      textAlign: 'center', padding: '40px 20px 32px',
      borderRadius: 20, marginBottom: 28,
      background: theme === 'dark'
        ? 'linear-gradient(135deg, rgba(49, 46, 129, 0.3) 0%, rgba(15, 23, 42, 0.8) 50%, rgba(30, 41, 59, 0.5) 100%)'
        : 'linear-gradient(135deg, rgba(224, 231, 255, 0.6) 0%, rgba(248, 250, 252, 0.8) 50%, rgba(253, 244, 255, 0.6) 100%)',
      border: '1px solid var(--border-primary)',
    }}>
      <div className="badge-pulse" style={{
        display: 'inline-block', padding: '4px 14px', borderRadius: 20,
        background: 'var(--accent-primary-light)', fontSize: 10, fontWeight: 700,
        letterSpacing: 1.5, color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: 12,
      }}>
        Dynamic Authority Framework
      </div>

      <h1 className="gradient-text-animated" style={{
        fontSize: 36, fontWeight: 800, margin: '8px 0',
        background: theme === 'dark'
          ? 'linear-gradient(135deg, #e2e8f0, #818cf8, #a78bfa, #e2e8f0)'
          : 'linear-gradient(135deg, #1e293b, #4338ca, #7c3aed, #1e293b)',
        backgroundSize: '200% 200%',
      }}>
        Governance Unit Engine
      </h1>

      <p style={{
        fontSize: 14, color: 'var(--text-tertiary)', maxWidth: 560, margin: '0 auto 20px',
        lineHeight: 1.6,
      }}>
        Replacing static Delegation of Authority tables with dynamic, AI-powered risk scoring
      </p>

      <div style={{
        display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap',
        fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)',
      }}>
        <span><strong style={{ color: 'var(--accent-primary)', fontSize: 18 }}>6</strong> Dimensions</span>
        <span style={{ color: 'var(--border-primary)' }}>•</span>
        <span><strong style={{ color: 'var(--accent-primary)', fontSize: 18 }}>5</strong> Tiers</span>
        <span style={{ color: 'var(--border-primary)' }}>•</span>
        <span><strong style={{ color: 'var(--accent-primary)', fontSize: 18 }}>∞</strong> Precision</span>
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

export default function App() {
  const [view, setView] = useState('analyzer');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [showOnboarding, setShowOnboarding] = useState(false);

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

  // Check first visit for onboarding
  useEffect(() => {
    if (!localStorage.getItem('gu-engine-onboarded')) {
      setShowOnboarding(true);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('gu-engine-onboarded', 'true');
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

  const tabs = [
    { id: 'analyzer', label: 'AI Contract Scorer', icon: '\u{1F916}' },
    { id: 'calculator', label: 'Manual Calculator', icon: '\u{1F9EE}' },
    { id: 'config', label: 'Configuration', icon: '\u{2699}\u{FE0F}' },
  ];

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <HistoryContext.Provider value={{ history, addToHistory, clearHistory }}>
        <div className="app-container" style={{ maxWidth: 960, margin: '0 auto', padding: '20px 14px', minHeight: '100vh' }}>
          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 12, gap: 6 }}>
            <button
              onClick={() => setHistoryOpen(true)}
              className="btn-interactive"
              style={{
                padding: '6px 10px', borderRadius: 8, border: '1.5px solid var(--border-primary)',
                background: 'var(--bg-card)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4,
                transition: 'all 0.3s',
              }}
            >
              History
              {history.length > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--accent-primary)',
                  borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center',
                }}>{history.length}</span>
              )}
            </button>
            <ThemeToggle theme={theme} toggle={toggleTheme} />
          </div>

          {/* Hero Section */}
          <HeroSection theme={theme} />

          {/* Tab bar */}
          <div className="tab-bar" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => { setView(tab.id); setRestoredResult(null); }} className="btn-interactive" style={{
                padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: view === tab.id
                  ? (theme === 'dark' ? 'var(--accent-primary)' : '#1e293b')
                  : 'var(--bg-card)',
                color: view === tab.id ? '#fff' : 'var(--text-tertiary)',
                fontSize: 13, fontWeight: 600, transition: 'all 0.3s',
                boxShadow: view === tab.id ? 'var(--shadow-md)' : 'var(--shadow-sm)',
              }}>{tab.icon} {tab.label}</button>
            ))}
          </div>

          {/* Content with tab transition */}
          <div key={view} className="tab-content-enter">
            {view === 'analyzer' && <ContractAnalyzer config={config} restoredResult={restoredResult} onResultClear={() => setRestoredResult(null)} />}
            {view === 'calculator' && <GUCalculator config={config} />}
            {view === 'config' && <ConfigPanel config={config} setConfig={setConfig} />}
          </div>

          {/* Footer */}
          <footer style={{
            textAlign: 'center', marginTop: 40, padding: '16px 0',
            borderTop: '1px solid var(--border-primary)', fontSize: 11, color: 'var(--text-muted)',
          }}>
            GU Engine v2 — Replacing static Delegation of Authority with dynamic risk scoring
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

        {/* Onboarding overlay */}
        {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
      </HistoryContext.Provider>
    </ThemeContext.Provider>
  );
}
