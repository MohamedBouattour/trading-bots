import { useState, useEffect } from 'react';
import type { StrategyBlueprint } from '../types';
import { createStrategy, updateStrategy } from '../api';

interface Props {
  blueprint?: StrategyBlueprint;
  onClose: () => void;
  onSuccess: () => void;
}

export function StrategyEditorModal({ blueprint, onClose, onSuccess }: Props) {
  const isEditing = !!blueprint;
  
  const [formData, setFormData] = useState<StrategyBlueprint>(blueprint || {
    id: '',
    name: '',
    symbols: ['BTCUSDT'],
    loop: { intervalSeconds: 900 },
    indicators: [],
    rules: [],
    riskManagement: {
      maxPositionPct: 10,
      stopLossPct: 2,
      takeProfitPct: 5
    }
  });

  const [jsonText, setJsonText] = useState(JSON.stringify(formData, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const parsed = JSON.parse(jsonText) as StrategyBlueprint;
      
      if (!parsed.id) throw new Error('Strategy ID is required');
      
      if (isEditing) {
        await updateStrategy(blueprint.id, parsed);
      } else {
        await createStrategy(parsed);
      }
      
      onSuccess();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
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
        maxWidth: 800,
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow)'
      }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
            {isEditing ? `Edit Strategy: ${blueprint.id}` : 'Create New Strategy'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>&times;</button>
        </div>

        <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflow: 'hidden' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Edit the strategy blueprint JSON below. Ensure the <code>id</code> matches the filename you want.
          </div>
          
          {error && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--error)', borderRadius: 'var(--radius)', color: 'var(--error)', fontSize: '0.8125rem' }}>
              {error}
            </div>
          )}

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              background: '#0a0c10',
              color: '#4ade80',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              padding: '1rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              outline: 'none',
              resize: 'none'
            }}
          />
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button 
            onClick={onClose}
            style={{ 
              padding: '0.5rem 1rem', 
              borderRadius: 'var(--radius)', 
              background: 'transparent', 
              color: 'var(--text)', 
              border: '1px solid var(--border)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            style={{ 
              padding: '0.5rem 1.5rem', 
              borderRadius: 'var(--radius)', 
              background: 'var(--accent)', 
              color: 'white', 
              border: 'none', 
              fontWeight: 700,
              cursor: 'pointer',
              opacity: saving ? 0.7 : 1
            }}
          >
            {saving ? 'Saving...' : 'Save Strategy'}
          </button>
        </div>
      </div>
    </div>
  );
}
