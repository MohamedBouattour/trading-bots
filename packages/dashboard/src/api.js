const BASE = '/api';
export async function fetchStates() {
    const res = await fetch(`${BASE}/states`);
    if (!res.ok)
        throw new Error('Failed to fetch states');
    return res.json();
}
export async function fetchBlueprints() {
    const res = await fetch(`${BASE}/strategies`);
    if (!res.ok)
        throw new Error('Failed to fetch blueprints');
    return res.json();
}
export async function fetchState(strategyId) {
    const res = await fetch(`${BASE}/states/${strategyId}`);
    if (!res.ok)
        throw new Error(`State not found: ${strategyId}`);
    return res.json();
}
