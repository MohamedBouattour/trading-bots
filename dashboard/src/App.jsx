import { useEffect, useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts'
import { Activity, Wallet, TrendingUp, DollarSign, Layers } from 'lucide-react'
import { parseLog, INITIAL_BALANCE } from './utils/parser'

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchLog = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}rebalancer.log?t=${new Date().getTime()}`, {
          cache: 'no-store'
        });
        if (!res.ok) throw new Error('Failed to fetch log');
        const text = await res.text();
        const parsed = parseLog(text);
        setData(parsed);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Could not load log data. Ensure the bot is running and log is accessible.');
        setLoading(false);
      }
    };

    fetchLog();
    // Refresh every 10 seconds
    const interval = setInterval(fetchLog, 10000);
    return () => clearInterval(interval);
  }, []);

  const chartData = useMemo(() => {
    if (!data?.history) return [];
    // Decimate data if it's too large to prevent UI freezing (max 100 points)
    const history = data.history;
    const step = Math.max(1, Math.floor(history.length / 100));
    const reduced = [];
    for (let i = 0; i < history.length; i += step) {
      reduced.push(history[i]);
    }
    // Always include the last point
    if (reduced.length > 0 && reduced[reduced.length - 1] !== history[history.length - 1]) {
      reduced.push(history[history.length - 1]);
    }
    
    return reduced.map(item => ({
      time: item.timestamp.split(' ')[1], // just time for x-axis
      fullTime: item.timestamp,
      value: item.trueEquity,
      notional: item.portfolioValue,
      roi: item.roi
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2>Syncing with Binance...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <h2 style={{ color: 'var(--danger)' }}>{error}</h2>
      </div>
    );
  }

  const { latest, settings } = data;

  if (!latest) {
    return (
      <div className="dashboard-container" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <h2>No valid portfolio data found in logs.</h2>
      </div>
    );
  }

  const isProfit = latest.roi >= 0;

  return (
    <div className="dashboard-container">
      <header>
        <div className="title-container">
          <h1>HODL Rebalancer</h1>
          <p>Live Portfolio Monitor</p>
        </div>
        <div className="status-badge">
          <div className="status-dot"></div>
          ACTIVE
        </div>
      </header>

      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div className="stat-label"><Wallet size={16} /> Total Equity</div>
          <div className="stat-value">${latest.trueEquity?.toFixed(2) || '0.00'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Notional: ${latest.portfolioValue?.toFixed(2)}</div>
        </div>
        
        <div className="glass-card stat-item">
          <div className="stat-label"><Activity size={16} /> Free USDT</div>
          <div className="stat-value">${latest.freeMargin?.toFixed(2) || '0.00'}</div>
        </div>

        <div className="glass-card stat-item">
          <div className="stat-label"><TrendingUp size={16} /> ROI (Since Apr 7)</div>
          <div className={`stat-value ${isProfit ? 'success' : 'danger'}`}>
            {isProfit ? '+' : ''}{latest.roi?.toFixed(2)}%
          </div>
        </div>

        <div className="glass-card stat-item">
          <div className="stat-label"><Layers size={16} /> Total Rebalances</div>
          <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>{latest.rebalances}</div>
        </div>
      </div>

      <div className="main-grid">
        <div className="glass-card chart-container">
          <div className="chart-header">
            <h2 className="chart-title">Equity Curve</h2>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={['auto', 'auto']} stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={val => '$' + val} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px' }}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: '4px' }}
                formatter={(value, name) => [name === 'value' ? `$${value}` : `${value.toFixed(2)}%`, name === 'value' ? 'Portfolio Value' : 'ROI']}
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullTime || label}
              />
              <Area type="monotone" dataKey="value" stroke="var(--accent-primary)" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chart-header">
            <h2 className="chart-title">Bot Settings</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
            {settings ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Interval</span>
                  <span style={{ fontWeight: 500 }}>{settings.interval}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Drift Threshold</span>
                  <span style={{ fontWeight: 500 }}>±{settings.drift}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Asset PnL Harvest</span>
                  <span style={{ fontWeight: 500, color: settings.assetHarvest !== 'OFF' ? 'var(--success)' : 'var(--text-muted)' }}>{settings.assetHarvest}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Auto-Scale</span>
                  <span style={{ fontWeight: 500, color: settings.autoScale === 'ON' ? 'var(--success)' : 'var(--text-muted)' }}>{settings.autoScale}</span>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Settings not found in log</div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card assets-container">
        <div className="chart-header" style={{ marginBottom: '1.5rem' }}>
          <h2 className="chart-title">Asset Allocation</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Current allocation weights vs target ratios. Rebalancing occurs when drift exceeds ±{settings?.drift || '5.0'}%.</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Notional</th>
              <th>Current Weight</th>
              <th>Target Ratio</th>
              <th>Drift</th>
              <th>Entry Price</th>
              <th>Current Price</th>
              <th>Unrealized PnL</th>
            </tr>
          </thead>
          <tbody>
            {latest.assets.map((asset, i) => (
              <tr key={i}>
                <td>
                  <div className="asset-symbol">
                    <DollarSign size={14} style={{ color: 'var(--accent-secondary)' }} />
                    {asset.symbol.replace('USDT', '')}
                  </div>
                </td>
                <td style={{ fontWeight: 500 }}>${asset.notional.toFixed(2)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '45px' }}>{asset.weight.toFixed(1)}%</div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${(asset.weight / 100) * 100}%` }}></div>
                    </div>
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>{asset.target.toFixed(1)}%</td>
                <td style={{ color: asset.drift >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                  {asset.drift > 0 ? '+' : ''}{asset.drift.toFixed(1)}%
                </td>
                <td style={{ color: 'var(--text-muted)' }}>${asset.entry.toFixed(2)}</td>
                <td>${asset.mark.toFixed(2)}</td>
                <td className={asset.pnlValue >= 0 ? 'pnl-positive' : 'pnl-negative'} style={{ fontWeight: 500 }}>
                  {asset.pnlStr}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default App
