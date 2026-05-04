export interface TradeResult {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  executedQty: number;
  executedPrice: number;
  commission: number;
  status: "FILLED" | "PARTIALLY_FILLED" | "FAILED";
}

export interface SymbolConstraints {
  minNotional: number;
  stepSize: string;
  tickSize: string;
  minQty: string;
}

export interface ITradeExecutor {
  executeMarketOrder(symbol: string, side: "BUY" | "SELL", amountUSDT: number): Promise<TradeResult>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  getSymbolConstraints(symbol: string): Promise<SymbolConstraints>;
}
