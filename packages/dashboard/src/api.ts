import type { BotState, StrategyBlueprint } from './types';

const BASE = '/api';

export async function fetchStates(): Promise<BotState[]> {
  const res = await fetch(`${BASE}/states`);
  if (!res.ok) throw new Error('Failed to fetch states');
  return res.json();
}

export async function fetchBlueprints(): Promise<StrategyBlueprint[]> {
  const res = await fetch(`${BASE}/strategies`);
  if (!res.ok) throw new Error('Failed to fetch blueprints');
  return res.json();
}

export async function fetchState(strategyId: string): Promise<BotState> {
  const res = await fetch(`${BASE}/states/${strategyId}`);
  if (!res.ok) throw new Error(`State not found: ${strategyId}`);
  return res.json();
}

export async function createStrategy(blueprint: StrategyBlueprint): Promise<StrategyBlueprint> {
  const res = await fetch(`${BASE}/strategies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blueprint),
  });
  if (!res.ok) throw new Error('Failed to create strategy');
  return res.json();
}

export async function updateStrategy(id: string, blueprint: StrategyBlueprint): Promise<StrategyBlueprint> {
  const res = await fetch(`${BASE}/strategies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(blueprint),
  });
  if (!res.ok) throw new Error('Failed to update strategy');
  return res.json();
}

export async function deleteStrategy(id: string): Promise<void> {
  const res = await fetch(`${BASE}/strategies/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete strategy');
}
