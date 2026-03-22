import axios from "axios";
import { Candle } from "../../../../shared/domain/models/Candle";
import { IMarketDataProvider } from "../../../domain/ports/IMarketDataProvider";

export class BinanceMarketDataProvider implements IMarketDataProvider {
  private readonly BINANCE_SPOT_URL = "https://api.binance.com/api/v3/klines";
  private readonly BINANCE_FUTURES_URL =
    "https://fapi.binance.com/fapi/v1/klines";

  async getHistoricalData(
    symbol: string = "BTCUSDT",
    interval: string = "1h",
    limit: number = 1000,
    months: number = 6,
  ): Promise<Candle[]> {
    const useFutures = process.env.USE_FUTURES === "true";
    const baseUrl = useFutures
      ? this.BINANCE_FUTURES_URL
      : this.BINANCE_SPOT_URL;

    const end_ms = Date.now();
    let start_ms = end_ms - months * 30 * 24 * 60 * 60 * 1000;
    const rows: Candle[] = [];

    while (start_ms < end_ms) {
      try {
        const resp = await axios.get(baseUrl, {
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
