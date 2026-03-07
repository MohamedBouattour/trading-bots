import axios from "axios";
import { IMarketDataPort } from "../../domain/port/IMarketDataPort";
import { Candle } from "../../domain/model/Candle";

const BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

/**
 * Binance REST adapter for the IMarketDataPort domain port.
 * Fetches paginated kline data and maps raw array rows to typed Candle objects.
 */
export class BinanceMarketDataAdapter implements IMarketDataPort {
  async getHistoricalData(
    symbol: string,
    interval: string,
    limit: number,
  ): Promise<Candle[]> {
    try {
      const response = await axios.get(BINANCE_KLINES_URL, {
        params: { symbol, interval, limit },
        timeout: 30_000,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return response.data.map((row: any[]): Candle => ({
        timestamp: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    } catch (error) {
      throw new Error(`[BinanceMarketDataAdapter] Failed to fetch klines: ${String(error)}`);
    }
  }
}
