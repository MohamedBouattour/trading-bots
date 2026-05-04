import { useState, useEffect } from 'react';
import { fetchStates, fetchBlueprints } from '../api';
export function useStrategyStates(intervalMs = 10000) {
    const [states, setStates] = useState([]);
    const [blueprints, setBlueprints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const [s, b] = await Promise.all([fetchStates(), fetchBlueprints()]);
                if (alive) {
                    setStates(s);
                    setBlueprints(b);
                    setError(null);
                }
            }
            catch (e) {
                if (alive)
                    setError(String(e));
            }
            finally {
                if (alive)
                    setLoading(false);
            }
        };
        load();
        const id = setInterval(load, intervalMs);
        return () => { alive = false; clearInterval(id); };
    }, [intervalMs]);
    return { states, blueprints, loading, error };
}
