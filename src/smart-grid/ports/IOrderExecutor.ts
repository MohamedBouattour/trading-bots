export interface IOrderExecutor {
  openMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quoteQty: number,
    testOnly?: boolean,
  ): Promise<void>;
}
