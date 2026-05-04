export type TradeDirection = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'CLOSED';

export interface TradeRecord {
  id: string;
  strategyId: string;
  symbol: string;
  direction: TradeDirection;
  status: TradeStatus;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  leverage: number;
  entryTime: number;   // unix ms
  exitTime?: number;
  pnlUsd?: number;
  pnlPct?: number;
  triggeredRuleId: string;
  closedByRuleId?: string;
}
