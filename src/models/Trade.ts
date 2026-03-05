export interface Trade {
  timestamp: number;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  reason?: string | null;
  pnl?: number;
}
