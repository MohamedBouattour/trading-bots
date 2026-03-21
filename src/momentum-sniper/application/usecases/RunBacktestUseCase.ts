import { IMarketDataProvider } from "../../ports/IMarketDataProvider";
import { IReportGenerator } from "../../ports/IReportGenerator";
import { IBot } from "../../domain/bot/IBot";

export class RunBacktestUseCase {
  constructor(
    private marketDataProvider: IMarketDataProvider,
    private reportGenerator: IReportGenerator,
  ) {}

  async execute(
    bot: IBot,
    outputPath: string,
    months: number = 6,
    timeframe: string = "1h",
  ): Promise<void> {
    console.log("=".repeat(60));
    console.log(" Momentum Sniper — Backtester (TS)");
    console.log("=".repeat(60));

    const symbol = bot.symbol;
    let df = await this.marketDataProvider.getHistoricalData(
      symbol,
      timeframe,
      1000,
      months,
    );

    if (df.length === 0) {
      console.log("No data available.");
      return;
    }

    // FIX #6: Filter out incomplete candles to avoid lookahead bias
    const now = Date.now();
    const tfMs = this._parseTimeframe(timeframe);
    const originalCount = df.length;
    df = df.filter(row => row.timestamp + tfMs <= now);
    
    if (df.length < originalCount) {
      console.log(`  Filtered out ${originalCount - df.length} incomplete candle(s).`);
    }

    if (df.length === 0) {
      console.log("No completed candles available.");
      return;
    }

    const startDate = new Date(df[0].timestamp).toLocaleDateString();
    const endDate = new Date(df[df.length - 1].timestamp).toLocaleDateString();

    console.log(`  Data range : ${startDate} → ${endDate}`);
    console.log(`  Total rows : ${df.length}`);

    const config = bot.get_config();
    // ... rest of the setup
    const HISTORY_BUFFER = 50;
    const historyCap = Math.max(
      (config.trend_period ?? 200) + HISTORY_BUFFER,
      300,
    );

    const closes: number[] = [];
    const volumes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];

    console.log(`\n  Running backtest on ${df.length} candles...`);

    for (const row of df) {
      // FIX #3: push history AFTER calling on_candle so that closes_history
      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        [...closes], // prior closes — current bar is NOT yet included
        [...volumes],
        [...highs],
        [...lows],
      );

      closes.push(row.close);
      volumes.push(row.volume);
      highs.push(row.high);
      lows.push(row.low);

      // Trim to cap AFTER the push so the arrays never grow unboundedly.
      if (closes.length > historyCap) closes.shift();
      if (volumes.length > historyCap) volumes.shift();
      if (highs.length > historyCap) highs.shift();
      if (lows.length > historyCap) lows.shift();
    }

    // FIX #5: settle any position still open when data ends.
    // Without this, unrealized P&L inflates final_value while Total Trades
    // and Win Rate both read 0 — because the sell trade was never recorded.
    const lastCandle = df[df.length - 1];
    bot.close_all_positions(lastCandle.close, lastCandle.timestamp);

    const results = bot.summary();
    console.log("\n" + "=".repeat(60));
    console.log(" Performance Summary");
    console.log("=".repeat(60));
    for (const [k, v] of Object.entries(results)) {
      const label = k
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
      console.log(`  ${label.padEnd(25)} ${v}`);
    }

    // FIX #1: await the report generation so "Done." only prints after the
    // file has been fully written and errors are not silently swallowed.
    await this.reportGenerator.generateReport(df, bot, outputPath);
    console.log("\nDone.");
  }

  private _parseTimeframe(tf: string): number {
    const unit = tf.slice(-1);
    const val = parseInt(tf.slice(0, -1));
    switch (unit) {
      case "m":
        return val * 60 * 1000;
      case "h":
        return val * 60 * 60 * 1000;
      case "d":
        return val * 24 * 60 * 60 * 1000;
      case "w":
        return val * 7 * 24 * 60 * 60 * 1000;
      case "M":
        return val * 30 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000; // 1h default
    }
  }
}
