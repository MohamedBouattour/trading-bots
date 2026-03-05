export interface IOrderExecutor {
  openMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quoteQty: number,
    testOnly?: boolean,
  ): Promise<void>;

  placeLimitOrder(
    symbol: string,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
    testOnly?: boolean,
  ): Promise<unknown>;

  cancelOrder(symbol: string, orderId: number): Promise<void>;

  getOpenOrders(symbol: string): Promise<unknown[]>;
}
