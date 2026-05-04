import type { BotState, StrategyBlueprint } from '../types';
import { KpiCard } from './KpiCard';
import { EquityChart } from './EquityChart';
import { TradeTable } from './TradeTable';
import { deleteStrategy } from '../api';

interface Props {
  state: BotState;
  blueprint?: StrategyBlueprint;
  onEdit?: () => void;
  onRefresh?: () => void;
}

export function StrategyCard({ state, blueprint, onEdit, onRefresh }: Props) {
  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${state.strategyId}? This will remove the blueprint and stop future cycles.`)) return;
    try {
      await deleteStrategy(state.strategyId);
      onRefresh?.();
    } catch (e) {
      alert(String(e));
    }
  };

  const allTrades = [...state.closedTrades, ...state.openTrades];
  const winCount = state.closedTrades.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const winRate = state.closedTrades.length > 0 ? (winCount / state.closedTrades.length) * 100 : 0;
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Never';
  
  const totalPnl = state.closedTrades.reduce((acc, t) => acc + (t.pnlUsd ?? 0), 0);
  const totalPnlPct = state.initialBalance > 0 ? (totalPnl / state.initialBalance) * 100 : 0;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{blueprint?.name ?? state.strategyId}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>
            {blueprint?.symbols.join(', ')} · Last run: {lastRun}
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem', marginRight: '1rem' }}>
          <button 
            onClick={onEdit}
            style={{ padding: '0.4rem 0.75rem', borderRadius: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: '0.75rem', fontWeight: 600 }}
          >
            Edit
          </button>
          <button 
            onClick={handleDelete}
            style={{ padding: '0.4rem 0.75rem', borderRadius: 4, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--error)', fontSize: '0.75rem', fontWeight: 600 }}
          >
            Delete
          </button>
        </div>

        <span style={{
          padding: '0.2rem 0.75rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
          background: state.status === 'halted' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)',
          color: state.status === 'halted' ? 'var(--error)' : 'var(--success)',
        }}>
          {state.status?.toUpperCase() ?? 'IDLE'}
        </span>
      </div>

      {state.status === 'halted' && state.haltReason && (
        <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid var(--border)', color: 'var(--error)', fontSize: '0.8125rem' }}>
          ⚠️ {state.haltReason}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'var(--border)' }}>
        {[
          { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, sub: `${totalPnlPct.toFixed(1)}%`, color: totalPnl >= 0 ? 'success' : 'error' as const },
          { label: 'Current Balance', value: `$${state.currentBalance.toFixed(2)}`, color: 'default' as const },
          { label: 'Daily Loss', value: `$${state.dailyLoss.toFixed(2)}`, color: state.dailyLoss > 0 ? 'error' : 'default' as const },
          { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, sub: `${winCount}/${state.closedTrades.length} trades`, color: 'default' as const },
          { label: 'Open Trades', value: String(state.openTrades.length), color: 'default' as const },
        ].map((k) => <div key={k.label} style={{ background: 'var(--surface)' }}><KpiCard {...k} /></div>)}
      </div>

      {/* Equity Chart */}
      <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.875rem' }}>Equity Curve</div>
        <EquityChart data={state.equityHistory} />
      </div>

      {/* Trade Table */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ padding: '1rem 1.5rem 0.5rem', fontWeight: 600, fontSize: '0.875rem' }}>Trade History</div>
        <TradeTable trades={allTrades} />
      </div>
    </div>
  );
}
