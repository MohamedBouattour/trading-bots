export interface TradeRecord {
  id: string;
  strategyId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  leverage: number;
  entryTime: number;
  exitTime?: number;
  pnlUsd?: number;
  pnlPct?: number;
  triggeredRuleId: string;
  closedByRuleId?: string;
}

export interface BotState {
  strategyId: string;
  status: 'running' | 'halted' | 'idle';
  lastRunAt: number;
  openTrades: TradeRecord[];
  closedTrades: TradeRecord[];
  equityHistory: Array<{ timestamp: number; equity: number }>;
  ruleHits: Array<{ ruleId: string; count: number }>;
  initialBalance: number;
  currentBalance: number;
  dailyLoss: number;
  dailyLossResetAt: number;
  haltReason?: string;
}

export interface StrategyBlueprint {
  id: string;
  name: string;
  symbols: string[];
  loop: { intervalSeconds: number };
  indicators: Array<{
    id: string;
    type: string;
    params: Record<string, number>;
    timeframe: string;
  }>;
  rules: Array<{
    id: string;
    priority: number;
    action: string;
    conditionGroup: any;
    params: Record<string, any>;
  }>;
  riskManagement: {
    maxPositionPct: number;
    stopLossPct?: number;
    takeProfitPct?: number;
    trailingStopPct?: number;
    maxDailyLossPct?: number;
  };
}
