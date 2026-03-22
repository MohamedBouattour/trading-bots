import { Candle } from "../../../shared/domain/models/Candle";

export interface IMarketDataProvider {
  getHistoricalData(
    symbol: string,
    interval: string,
    limit?: number,
    months?: number,
  ): Promise<Candle[]>;
}
