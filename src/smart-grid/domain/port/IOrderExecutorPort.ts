import { AssetBalance } from "../model/Balance";

/** Strongly-typed exchange order returned from getOpenOrders. */
export interface ExchangeOrder {
  readonly orderId: number;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly price: number;
  readonly origQty: number;
  readonly status: string;
}

/** Owned by the domain — infrastructure must adapt to this contract. */
export interface IOrderExecutorPort {
  getAccountBalances(): Promise<AssetBalance[]>;
  getOpenOrders(symbol: string): Promise<ExchangeOrder[]>;
  placeLimitOrder(
    symbol: string,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
  ): Promise<void>;
  cancelOrder(symbol: string, orderId: number): Promise<void>;
}
