import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { KpiCard } from './KpiCard';
import { EquityChart } from './EquityChart';
import { TradeTable } from './TradeTable';
export function StrategyCard({ state, blueprint }) {
    const allTrades = [...state.closedTrades, ...state.openTrades];
    const winCount = state.closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
    const winRate = state.closedTrades.length > 0 ? (winCount / state.closedTrades.length) * 100 : 0;
    const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Never';
    return (_jsxs("div", { style: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '1rem' }, children: blueprint?.name ?? state.strategyId }), _jsxs("div", { style: { color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }, children: [blueprint?.symbols.join(', '), " \u00B7 Last run: ", lastRun, " \u00B7 Cycles: ", state.runCount] })] }), _jsx("span", { style: {
                            padding: '0.2rem 0.75rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
                            background: state.halted ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)',
                            color: state.halted ? 'var(--error)' : 'var(--success)',
                        }, children: state.halted ? `HALTED` : 'RUNNING' })] }), state.halted && state.haltReason && (_jsxs("div", { style: { padding: '0.75rem 1.5rem', background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid var(--border)', color: 'var(--error)', fontSize: '0.8125rem' }, children: ["\u26A0\uFE0F ", state.haltReason] })), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: 'var(--border)' }, children: [
                    { label: 'Total P&L', value: `${state.totalPnl >= 0 ? '+' : ''}$${state.totalPnl.toFixed(2)}`, color: state.totalPnl >= 0 ? 'success' : 'error' },
                    { label: 'Daily P&L', value: `${state.dailyPnl >= 0 ? '+' : ''}$${state.dailyPnl.toFixed(2)}`, color: state.dailyPnl >= 0 ? 'success' : 'error' },
                    { label: 'Max Drawdown', value: `${state.maxDrawdown.toFixed(1)}%`, color: state.maxDrawdown > 10 ? 'error' : 'default' },
                    { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, sub: `${winCount}/${state.closedTrades.length} trades`, color: 'default' },
                    { label: 'Open Trades', value: String(state.openTrades.length), color: 'default' },
                ].map((k) => _jsx("div", { style: { background: 'var(--surface)' }, children: _jsx(KpiCard, { ...k }) }, k.label)) }), _jsxs("div", { style: { padding: '1.25rem 1.5rem', borderTop: '1px solid var(--border)' }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.875rem' }, children: "Equity Curve" }), _jsx(EquityChart, { data: state.equityHistory })] }), _jsxs("div", { style: { borderTop: '1px solid var(--border)' }, children: [_jsx("div", { style: { padding: '1rem 1.5rem 0.5rem', fontWeight: 600, fontSize: '0.875rem' }, children: "Trade History" }), _jsx(TradeTable, { trades: allTrades })] })] }));
}
