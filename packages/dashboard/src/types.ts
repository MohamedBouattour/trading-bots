export interface TradeRecord {
  id: string;
  strategyId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  sizeUSDT: number;
  pnl?: number;
  pnlPct?: number;
  openedAt: number;
  closedAt?: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  ruleId: string;
  tags: string[];
}

export interface BotState {
  strategyId: string;
  lastRunAt: number;
  runCount: number;
  equityHistory: Array<{ ts: number; equity: number }>;
  openTrades: TradeRecord[];
  closedTrades: TradeRecord[];
  dailyPnl: number;
  totalPnl: number;
  maxDrawdown: number;
  halted: boolean;
  haltReason?: string;
}

export interface StrategyBlueprint {
  id: string;
  name: string;
  version: string;
  description: string;
  symbols: string[];
  indicators: Array<{ id: string; type: string; params: Record<string, number>; timeframe: string }>;
  rules: Array<{
    id: string; name: string; priority: number; action: string;
    conditionGroup: unknown; params?: Record<string, unknown>;
  }>;
  loop: { intervalSeconds: number };
  riskManagement: { maxDrawdownPct: number; maxPositionPct: number; dailyLossLimitPct: number };
  metadata: { author: string; createdAt: string; tags: string[] };
}
