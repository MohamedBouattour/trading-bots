import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function KpiCard({ label, value, sub, color = 'default' }) {
    const colorMap = {
        default: 'var(--text)',
        success: 'var(--success)',
        error: 'var(--error)',
        warning: 'var(--warning)',
    };
    return (_jsxs("div", { style: {
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '1.25rem 1.5rem',
        }, children: [_jsx("div", { style: { color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }, children: label }), _jsx("div", { style: { fontSize: '1.75rem', fontWeight: 700, color: colorMap[color], fontVariantNumeric: 'tabular-nums' }, children: value }), sub && _jsx("div", { style: { color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }, children: sub })] }));
}
