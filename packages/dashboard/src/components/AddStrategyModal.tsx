import { useState } from 'react';

interface Props {
  onClose: () => void;
}

export function AddStrategyModal({ onClose }: Props) {
  const exampleJson = {
    id: "new-strategy-v1",
    name: "New Trend Follower",
    symbols: ["BTCUSDT"],
    loop: { intervalSeconds: 900 },
    indicators: [
      { id: "ema20", type: "EMA", params: { period: 20 }, timeframe: "1h" },
      { id: "ema50", type: "EMA", params: { period: 50 }, timeframe: "1h" }
    ],
    rules: [
      {
        id: "long-entry",
        priority: 1,
        action: "BUY",
        params: { sizeMode: "fixed_usd", sizeValue: 100 },
        conditionGroup: {
          operator: "AND",
          conditions: [
            { type: "CROSS_OVER", leftId: "ema20", rightId: "ema50" }
          ]
        }
      }
    ],
    riskManagement: {
      maxPositionPct: 10,
      stopLossPct: 2,
      takeProfitPct: 5
    }
  };

  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(exampleJson, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '2rem'
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: 600,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3), 0 10px 10px -5px rgba(0,0,0,0.1)'
      }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>Add New Strategy</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
          <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            To add a new strategy, create a JSON file in the <code>/strategies</code> directory. 
            The engine will automatically detect and load it on the next restart.
          </p>

          <div style={{ position: 'relative', marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Blueprint Template</span>
              <button 
                onClick={copyToClipboard}
                style={{ 
                  fontSize: '0.75rem', 
                  padding: '0.25rem 0.5rem', 
                  borderRadius: 4, 
                  background: copied ? 'var(--success)' : 'var(--accent)', 
                  color: 'white', 
                  border: 'none', 
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
              >
                {copied ? 'Copied!' : 'Copy JSON'}
              </button>
            </div>
            <pre style={{ 
              background: '#111', 
              color: '#eee', 
              padding: '1rem', 
              borderRadius: 'var(--radius)', 
              fontSize: '0.75rem', 
              overflowX: 'auto',
              margin: 0,
              border: '1px solid #333'
            }}>
              {JSON.stringify(exampleJson, null, 2)}
            </pre>
          </div>
          
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.5rem' }}>Steps to activate:</div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              <li>Save the JSON above as <code>my-strat.json</code> in <code>/strategies</code>.</li>
              <li>Ensure your <code>.env</code> file has valid Binance API keys.</li>
              <li>Restart the engine (or wait for auto-reload if using dev mode).</li>
              <li>If valid, the strategy will appear as "Active" here once it completes its first cycle.</li>
            </ol>
          </div>
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{ 
              padding: '0.5rem 1.25rem', 
              borderRadius: 'var(--radius)', 
              background: 'var(--accent)', 
              color: 'white', 
              border: 'none', 
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
