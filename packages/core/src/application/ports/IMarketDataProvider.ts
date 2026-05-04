import { Candle } from "../../domain/models/Candle";
import { Timeframe } from "../../domain/models/StrategyBlueprint";

export interface IMarketDataProvider {
  /** Fetch OHLCV candles for a symbol and timeframe */
  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  /** Get the latest price for a symbol */
  getCurrentPrice(symbol: string): Promise<number>;
  /** Free margin available for new orders */
  getAvailableBalance(): Promise<number>;
  /** Total account equity including unrealised PnL */
  getTotalEquity(): Promise<number>;
}
