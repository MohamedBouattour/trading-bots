import { useStrategyStates } from './hooks/useStrategyStates';
import { StrategyCard } from './components/StrategyCard';

export default function App() {
  const { states, blueprints, loading, error } = useStrategyStates(10_000);

  const logo = (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="Trading Bots">
      <rect width="28" height="28" rx="6" fill="var(--accent)" fillOpacity="0.15" />
      <polyline points="4,20 9,12 13,16 17,8 24,14" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="24" cy="14" r="2" fill="var(--accent)" />
    </svg>
  );

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', height: 56, display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'sticky', top: 0, zIndex: 10 }}>
        {logo}
        <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Trading Bots</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          {states.length} strateg{states.length === 1 ? 'y' : 'ies'} · auto-refresh 10s
        </span>
      </header>

      <main style={{ flex: 1, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '2rem 1.5rem' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>Loading…</div>
        )}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '1rem 1.5rem', color: 'var(--error)', marginBottom: '1.5rem' }}>
            Could not connect to engine API — make sure the engine server is running.<br />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{error}</span>
          </div>
        )}
        {!loading && states.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No active strategies</div>
            <div style={{ fontSize: '0.875rem' }}>Add a blueprint JSON to /strategies and start the engine.</div>
          </div>
        )}
        {states.map((state) => (
          <StrategyCard
            key={state.strategyId}
            state={state}
            blueprint={blueprints.find((b) => b.id === state.strategyId)}
          />
        ))}
      </main>
    </div>
  );
}
