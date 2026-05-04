interface Props {
  label: string;
  value: string;
  sub?: string;
  color?: 'default' | 'success' | 'error' | 'warning';
}

export function KpiCard({ label, value, sub, color = 'default' }: Props) {
  const colorMap = {
    default: 'var(--text)',
    success: 'var(--success)',
    error: 'var(--error)',
    warning: 'var(--warning)',
  };
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '1.25rem 1.5rem',
    }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colorMap[color], fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  );
}
