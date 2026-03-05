import { Candle } from "../../../models/Candle";
import { IMarketDataProvider } from "../../ports/IMarketDataProvider";

export class SyntheticMarketDataProvider implements IMarketDataProvider {
  async getHistoricalData(
    symbol: string,
    interval: string,
    limit?: number,
    months?: number,
  ): Promise<Candle[]> {
    console.log("  Generating synthetic BTC/USDT data for demonstration...");
    const hours = (months || 6) * 30 * 24;
    const dt = 1 / (365 * 24);
    const mu = 0.6;
    const sigma = 0.8;
    let price = 40_000.0;
    const rows: Candle[] = [];
    let current_ts = Date.now() - hours * 3600 * 1000;

    for (let i = 0; i < hours; i++) {
      const drift = (mu - 0.5 * sigma * sigma) * dt;

      // Box muller
      let u = 0,
        v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      const std_norm =
        Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

      // the shock uses std_norm instead of uniform
      price *= Math.exp(drift + sigma * Math.sqrt(dt) * std_norm);

      const noise = 0.995 + Math.random() * 0.01;
      const open = price * noise;
      const close = price;
      const high = Math.max(open, close) * (1.0 + Math.random() * 0.01);
      const low = Math.min(open, close) * (0.99 + Math.random() * 0.01);
      const volume = 100 + Math.random() * 1900;

      rows.push({
        timestamp: current_ts,
        open,
        high,
        low,
        close,
        volume,
      });
      current_ts += 3600 * 1000;
    }
    return rows;
  }
}
