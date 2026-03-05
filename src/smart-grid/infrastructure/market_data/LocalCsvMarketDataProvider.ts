import * as fs from "fs";
import * as Papa from "papaparse";
import { Candle } from "../../../models/Candle";
import { IMarketDataProvider } from "../../ports/IMarketDataProvider";

export class LocalCsvMarketDataProvider implements IMarketDataProvider {
  constructor(private csvPath: string) {}

  async getHistoricalData(
    symbol: string,
    interval: string,
    limit?: number,
    months?: number,
  ): Promise<Candle[]> {
    if (!fs.existsSync(this.csvPath)) {
      return [];
    }

    console.log(`  Loading cached data from ${this.csvPath}`);
    const csvContent = fs.readFileSync(this.csvPath, "utf8");
    const parsed = Papa.parse(csvContent, {
      header: true,
      dynamicTyping: true,
    });

    if (parsed.data && parsed.data.length > 0) {
      return parsed.data
        .filter((d: any) => d.timestamp)
        .map((d: any) => ({
          timestamp: Number(d.timestamp),
          open: Number(d.open),
          high: Number(d.high),
          low: Number(d.low),
          close: Number(d.close),
          volume: Number(d.volume),
        }));
    }

    return [];
  }

  saveData(data: Candle[]): void {
    if (data.length > 0) {
      const csvData = Papa.unparse(data);
      fs.writeFileSync(this.csvPath, csvData, "utf8");
      console.log(`  Cached ${data.length} candles locally to ${this.csvPath}`);
    }
  }
}
