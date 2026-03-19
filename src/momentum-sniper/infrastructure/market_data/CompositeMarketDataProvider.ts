import { Candle } from "../../../models/Candle";
import { IMarketDataProvider } from "../../ports/IMarketDataProvider";
import { LocalCsvMarketDataProvider } from "./LocalCsvMarketDataProvider";
import { BinanceMarketDataProvider } from "./BinanceMarketDataProvider";
import { SyntheticMarketDataProvider } from "./SyntheticMarketDataProvider";

export class CompositeMarketDataProvider implements IMarketDataProvider {
  constructor(
    private localProvider: LocalCsvMarketDataProvider,
    private apiProvider: BinanceMarketDataProvider,
    private fallbackProvider: SyntheticMarketDataProvider,
  ) {}

  async getHistoricalData(
    symbol: string,
    interval: string,
    limit: number = 1000,
    months: number = 6,
  ): Promise<Candle[]> {
    // 1. Try local cache
    const cachedData = await this.localProvider.getHistoricalData(
      symbol,
      interval,
      limit,
      months,
    );

    if (cachedData.length > 0) {
      const lastCandle = cachedData[cachedData.length - 1];
      const intervalMs = this.parseIntervalToMs(interval);
      const now = Date.now();

      // If the latest candle in cache is older than (now - interval)
      // it means we are missing at least one candle (either currently in progress or fully closed)
      if (now - lastCandle.timestamp < intervalMs) {
        return cachedData;
      }
      console.log(
        `  Cached data is outdated by at least 1 candle (last: ${new Date(
          lastCandle.timestamp,
        ).toISOString()}). Re-fetching...`,
      );
    }

    // 2. Try API
    console.log("  Fetching data from Binance API...");
    try {
      const data = await this.apiProvider.getHistoricalData(
        symbol,
        interval,
        limit,
        months,
      );
      if (data && data.length > 0) {
        this.localProvider.saveData(data);
        return data;
      }
    } catch (exc) {
      console.log(
        `  Binance fetch failed: ${exc}. Falling back to synthetic data.`,
      );
    }

    // 3. Try fallback
    return await this.fallbackProvider.getHistoricalData(
      symbol,
      interval,
      limit,
      months,
    );
  }

  private parseIntervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)([smhdMwy])$/);
    if (!match) return 60 * 60 * 1000; // default to 1h
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      case "d":
        return value * 24 * 60 * 60 * 1000;
      case "w":
        return value * 7 * 24 * 60 * 60 * 1000;
      case "M":
        return value * 30 * 24 * 60 * 60 * 1000;
      default:
        return value * 60 * 1000;
    }
  }
}
