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
            {['Symbol', 'Dir', 'Entry', 'Exit', 'Size', 'PnL', 'PnL %', 'Status', 'Opened'].map((h) => (
              <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.slice().reverse().map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>{t.symbol}</td>
              <td style={{ padding: '0.5rem 0.75rem', color: t.direction === 'BUY' ? 'var(--success)' : 'var(--error)' }}>{t.direction}</td>
              <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>{t.entryPrice.toFixed(2)}</td>
              <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>{t.exitPrice?.toFixed(2) ?? '—'}</td>
              <td style={{ padding: '0.5rem 0.75rem', fontVariantNumeric: 'tabular-nums' }}>${t.sizeUSDT.toFixed(2)}</td>
              <td style={{ padding: '0.5rem 0.75rem', color: (t.pnl ?? 0) >= 0 ? 'var(--success)' : 'var(--error)', fontVariantNumeric: 'tabular-nums' }}>
                {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', color: (t.pnlPct ?? 0) >= 0 ? 'var(--success)' : 'var(--error)' }}>
                {t.pnlPct != null ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '—'}
              </td>
              <td style={{ padding: '0.5rem 0.75rem' }}>
                <span style={{ padding: '0.15rem 0.5rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: t.status === 'OPEN' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.1)', color: t.status === 'OPEN' ? 'var(--accent)' : 'var(--success)' }}>
                  {t.status}
                </span>
              </td>
              <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{new Date(t.openedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
