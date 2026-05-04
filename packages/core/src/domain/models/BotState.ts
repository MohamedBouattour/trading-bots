import { TradeRecord } from "./TradeRecord";

export interface BotState {
  strategyId: string;
  lastRunAt: number;       // unix ms
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
