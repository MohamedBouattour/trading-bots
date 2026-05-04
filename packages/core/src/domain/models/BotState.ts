import type { TradeRecord } from './TradeRecord.js';

export interface EquityPoint {
  timestamp: number;
  equity: number;
}

export interface RuleHitCount {
  ruleId: string;
  count: number;
}

export interface BotState {
  strategyId: string;
  status: 'running' | 'halted' | 'idle';
  lastRunAt: number;          // unix ms
  openTrades: TradeRecord[];
  closedTrades: TradeRecord[];
  equityHistory: EquityPoint[];
  ruleHits: RuleHitCount[];
  initialBalance: number;
  currentBalance: number;
  dailyLoss: number;
  dailyLossResetAt: number;
  haltReason?: string;
}
