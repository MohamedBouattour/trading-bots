import { Candle } from "../../models/Candle";

export interface IMarketDataProvider {
  getHistoricalData(
    symbol: string,
    interval: string,
    limit?: number,
    months?: number,
  ): Promise<Candle[]>;
}
