export interface Trade {
  timestamp: any;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  reason?: string | null;
  pnl?: number;
}
