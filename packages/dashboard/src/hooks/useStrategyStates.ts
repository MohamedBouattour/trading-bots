import { useState, useEffect, useCallback } from 'react';
import { fetchStates, fetchBlueprints } from '../api';
import type { BotState, StrategyBlueprint } from '../types';

export function useStrategyStates(intervalMs = 10_000) {
  const [states, setStates] = useState<BotState[]>([]);
  const [blueprints, setBlueprints] = useState<StrategyBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([fetchStates(), fetchBlueprints()]);
      setStates(s);
      setBlueprints(b);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (intervalMs > 0) {
      const id = setInterval(load, intervalMs);
      return () => clearInterval(id);
    }
  }, [load, intervalMs]);

  return { states, blueprints, loading, error, refresh: load };
}
