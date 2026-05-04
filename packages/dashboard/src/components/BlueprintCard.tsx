import type { StrategyBlueprint } from '../types';
import { deleteStrategy } from '../api';

interface Props {
  blueprint: StrategyBlueprint;
  onEdit: () => void;
  onRefresh: () => void;
}

export function BlueprintCard({ blueprint, onEdit, onRefresh }: Props) {
  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${blueprint.id}?`)) return;
    try {
      await deleteStrategy(blueprint.id);
      onRefresh();
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div style={{ 
      background: 'var(--surface)', 
      border: '1px solid var(--border)', 
      borderRadius: 'var(--radius)', 
      padding: '1rem 1.5rem',
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ 
        width: 40, 
        height: 40, 
        borderRadius: 8, 
        background: 'var(--accent)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        fontSize: '1.2rem',
        opacity: 0.5
      }}>
        📄
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{blueprint.name}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>
          ID: {blueprint.id} · {blueprint.symbols.join(', ')} · {blueprint.loop.intervalSeconds}s interval
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '0.5rem', marginRight: '1rem' }}>
        <button 
          onClick={onEdit}
          style={{ padding: '0.4rem 0.75rem', borderRadius: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: '0.75rem', fontWeight: 600 }}
        >
          Edit
        </button>
        <button 
          onClick={handleDelete}
          style={{ padding: '0.4rem 0.75rem', borderRadius: 4, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--error)', fontSize: '0.75rem', fontWeight: 600 }}
        >
          Delete
        </button>
      </div>

      <div style={{ textAlign: 'right', minWidth: 100 }}>
        <span style={{ 
          fontSize: '0.7rem', 
          fontWeight: 700, 
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          In Standby
        </span>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          No active state
        </div>
      </div>
    </div>
  );
}
