import type { Candle } from '../../domain/models/Candle.js';

export interface IMarketDataProvider {
  getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]>;
  getLatestPrice(symbol: string): Promise<number>;
  getAccountBalance(): Promise<number>;
}
