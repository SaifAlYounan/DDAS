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

function CorporateHeader({ theme, toggleTheme, history, onHistoryOpen }) {
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
    { id: 'analyzer', label: 'AI Contract Scorer' },
    { id: 'calculator', label: 'Manual Calculator' },
    { id: 'config', label: 'Configuration' },
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
          />

          {/* Tab bar — document style */}
          <div className="tab-bar no-print" style={{
            background: 'var(--bg-card)', borderRadius: 10,
            border: '1px solid var(--border-primary)', display: 'flex',
            marginBottom: 24, overflow: 'hidden', padding: '0 8px',
          }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => { setView(tab.id); setRestoredResult(null); }} style={{
                padding: '11px 20px', background: 'transparent', cursor: 'pointer',
                border: 'none',
                borderBottom: view === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: view === tab.id ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                fontSize: 13, fontWeight: view === tab.id ? 700 : 500,
                transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}>
                {tab.label}
              </button>
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

        {/* Onboarding overlay */}
        {showOnboarding && <OnboardingOverlay onDismiss={dismissOnboarding} />}
      </HistoryContext.Provider>
    </ThemeContext.Provider>
  );
}
