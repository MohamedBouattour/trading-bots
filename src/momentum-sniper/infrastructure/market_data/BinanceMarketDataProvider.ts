import axios from "axios";
import { Candle } from "../../../models/Candle";
import { IMarketDataProvider } from "../../ports/IMarketDataProvider";

export class BinanceMarketDataProvider implements IMarketDataProvider {
  private readonly BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines";

  async getHistoricalData(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 1000,
    months: number = 6,
  ): Promise<Candle[]> {
    const end_ms = Date.now();
    let start_ms = end_ms - months * 30 * 24 * 60 * 60 * 1000;
    const rows: Candle[] = [];

    while (start_ms < end_ms) {
      try {
        const resp = await axios.get(this.BINANCE_KLINES_URL, {
          params: {
            symbol: symbol,
            interval: interval,
            startTime: start_ms,
            endTime: end_ms,
            limit: limit,
          },
          timeout: 30000,
        });

        const data = resp.data;
        if (!data || data.length === 0) break;

        for (const row of data) {
          rows.push({
            timestamp: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          });
        }

        start_ms = Number(data[data.length - 1][0]) + 1;
        if (data.length < limit) break;
      } catch (error) {
        console.error("Error fetching binance data", error);
        break;
      }
    }

    return rows;
  }
}
