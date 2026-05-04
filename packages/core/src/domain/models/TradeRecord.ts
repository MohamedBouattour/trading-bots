export type TradeDirection = "BUY" | "SELL";
export type TradeStatus = "OPEN" | "CLOSED" | "CANCELLED";

export interface TradeRecord {
  id: string;
  strategyId: string;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  sizeUSDT: number;
  pnl?: number;
  pnlPct?: number;
  openedAt: number;   // unix ms
  closedAt?: number;
  status: TradeStatus;
  ruleId: string;     // which rule triggered this trade
  tags: string[];
}
