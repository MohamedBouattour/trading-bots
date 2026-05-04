import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
export function EquityChart({ data }) {
    const formatted = data.map((d) => ({
        time: new Date(d.ts).toLocaleDateString(),
        equity: +d.equity.toFixed(2),
    }));
    if (formatted.length === 0) {
        return (_jsx("div", { style: { height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }, children: "No equity history yet" }));
    }
    return (_jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(LineChart, { data: formatted, margin: { top: 8, right: 16, left: 0, bottom: 0 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "var(--border)" }), _jsx(XAxis, { dataKey: "time", tick: { fill: 'var(--text-muted)', fontSize: 11 }, axisLine: false, tickLine: false }), _jsx(YAxis, { tick: { fill: 'var(--text-muted)', fontSize: 11 }, axisLine: false, tickLine: false, width: 70 }), _jsx(Tooltip, { contentStyle: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }, formatter: (v) => [`$${v.toFixed(2)}`, 'Equity'] }), _jsx(Line, { type: "monotone", dataKey: "equity", stroke: "var(--accent)", strokeWidth: 2, dot: false })] }) }));
}
