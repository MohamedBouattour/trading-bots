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
    if (cachedData.length > 0) return cachedData;

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
}
