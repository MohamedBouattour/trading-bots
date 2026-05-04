import type { TradeRecord } from '../types';

interface Props { trades: TradeRecord[]; }

export function TradeTable({ trades }: Props) {
  if (trades.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-faint)' }}>No trades yet</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Symbol', 'Dir', 'Entry', 'Exit', 'Qty', 'PnL', 'PnL %', 'Status', 'Opened'].map((h) => (
              <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.slice().reverse().map((t) => {
            const pnl = t.pnlUsd;
            const pnlPct = t.pnlPct;
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t.symbol}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: t.direction === 'LONG' ? 'var(--success)' : 'var(--error)' }}>{t.direction}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>{t.entryPrice.toFixed(2)}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>{t.exitPrice?.toFixed(2) ?? '—'}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>{t.quantity.toFixed(4)}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: (pnl ?? 0) >= 0 ? 'var(--success)' : 'var(--error)', fontVariantNumeric: 'tabular-nums' }}>
                  {pnl != null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', color: (pnlPct ?? 0) >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <span style={{ padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: t.status === 'OPEN' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.1)', color: t.status === 'OPEN' ? 'var(--accent)' : 'var(--success)' }}>
                    {t.status}
                  </span>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{new Date(t.entryTime).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
