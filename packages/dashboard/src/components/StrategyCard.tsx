import type { BotState, StrategyBlueprint } from '../types';
import { KpiCard } from './KpiCard';
import { EquityChart } from './EquityChart';
import { TradeTable } from './TradeTable';

interface Props {
  state: BotState;
  blueprint?: StrategyBlueprint;
}

export function StrategyCard({ state, blueprint }: Props) {
  const allTrades = [...state.closedTrades, ...state.openTrades];
  const winCount = state.closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = state.closedTrades.length > 0 ? (winCount / state.closedTrades.length) * 100 : 0;
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Never';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{blueprint?.name ?? state.strategyId}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>
            {blueprint?.symbols.join(', ')} · Last run: {lastRun} · Cycles: {state.runCount}
          </div>
        </div>
        <span style={{
          padding: '0.2rem 0.75rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
          background: state.halted ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)',
          color: state.halted ? 'var(--error)' : 'var(--success)',
        }}>
          {state.halted ? `HALTED` : 'RUNNING'}
        </span>
      </div>

      {state.halted && state.haltReason && (
        <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid var(--border)', color: 'var(--error)', fontSize: '0.8125rem' }}>
          ⚠️ {state.haltReason}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'var(--border)' }}>
        {[
          { label: 'Total P&L', value: `${state.totalPnl >= 0 ? '+' : ''}$${state.totalPnl.toFixed(2)}`, color: state.totalPnl >= 0 ? 'success' : 'error' as const },
          { label: 'Daily P&L', value: `${state.dailyPnl >= 0 ? '+' : ''}$${state.dailyPnl.toFixed(2)}`, color: state.dailyPnl >= 0 ? 'success' : 'error' as const },
          { label: 'Max Drawdown', value: `${state.maxDrawdown.toFixed(1)}%`, color: state.maxDrawdown > 10 ? 'error' : 'default' as const },
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
