import { useState, useEffect } from 'react';
import { fetchStates, fetchBlueprints } from '../api';
import type { BotState, StrategyBlueprint } from '../types';

export function useStrategyStates(intervalMs = 10_000) {
  const [states, setStates] = useState<BotState[]>([]);
  const [blueprints, setBlueprints] = useState<StrategyBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, b] = await Promise.all([fetchStates(), fetchBlueprints()]);
        if (alive) { setStates(s); setBlueprints(b); setError(null); }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [intervalMs]);

  return { states, blueprints, loading, error };
}
