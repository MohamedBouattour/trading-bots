import { useState, useCallback } from 'react';
import { useStrategyStates } from './hooks/useStrategyStates';
import { StrategyCard } from './components/StrategyCard';
import { BlueprintCard } from './components/BlueprintCard';
import { StrategyEditorModal } from './components/StrategyEditorModal';
import type { StrategyBlueprint } from './types';

export default function App() {
  const { states, blueprints, loading, error, refresh } = useStrategyStates(10_000);
  const [editingBlueprint, setEditingBlueprint] = useState<StrategyBlueprint | null | undefined>(undefined);

  const activeIds = new Set(states.map((s) => s.strategyId));
  const availableBlueprints = blueprints.filter((b) => !activeIds.has(b.id));

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <img src="/logo.png" alt="Logo" style={{ width: 32, height: 32, borderRadius: 8 }} />
    </div>
  );

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Navbar */}
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', height: 64, display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'sticky', top: 0, zIndex: 10 }}>
        {logo}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 700, fontSize: '0.9375rem', lineHeight: 1 }}>Trading Bots</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '0.2rem' }}>
            {states.length} active · {blueprints.length} total · 10s refresh
          </span>
        </div>
        
        <button 
          onClick={() => setEditingBlueprint(null)}
          style={{ 
            marginLeft: 'auto',
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius)',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <span>+</span> Add Strategy
        </button>
      </header>

      <main style={{ flex: 1, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '2rem 1.5rem' }}>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '1rem 1.5rem', color: 'var(--error)', marginBottom: '1.5rem' }}>
            Could not connect to engine API — make sure the engine server is running.<br />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{error}</span>
          </div>
        )}

        {loading && states.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>Loading…</div>
        )}

        {!loading && states.length === 0 && availableBlueprints.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📂</div>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No strategies found</div>
            <div style={{ fontSize: '0.875rem' }}>Click "Add Strategy" to create your first blueprint.</div>
          </div>
        )}

        {/* Active Strategies */}
        {states.length > 0 && (
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              Active Strategies
            </h2>
            {states.map((state) => (
              <StrategyCard
                key={state.strategyId}
                state={state}
                blueprint={blueprints.find((b) => b.id === state.strategyId)}
                onEdit={() => setEditingBlueprint(blueprints.find((b) => b.id === state.strategyId))}
                onRefresh={handleRefresh}
              />
            ))}
          </div>
        )}

        {/* Available Blueprints (Loaded but no state) */}
        {availableBlueprints.length > 0 && (
          <div>
            <h2 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              Available Blueprints
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
              {availableBlueprints.map((blueprint) => (
                <BlueprintCard 
                  key={blueprint.id} 
                  blueprint={blueprint} 
                  onEdit={() => setEditingBlueprint(blueprint)}
                  onRefresh={handleRefresh}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {editingBlueprint !== undefined && (
        <StrategyEditorModal 
          blueprint={editingBlueprint || undefined} 
          onClose={() => setEditingBlueprint(undefined)} 
          onSuccess={handleRefresh}
        />
      )}
    </div>
  );
}

