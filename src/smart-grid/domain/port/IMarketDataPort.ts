import { Candle } from "../model/Candle";

/** Owned by the domain — infrastructure must adapt to this contract. */
export interface IMarketDataPort {
  /**
   * Returns the most recent `limit` closed candles for the given symbol.
   * Use limit=1 to get just the latest price.
   */
  getHistoricalData(
    symbol: string,
    interval: string,
    limit: number,
  ): Promise<Candle[]>;
}
