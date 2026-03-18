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
    const df = await this.marketDataProvider.getHistoricalData(
      symbol,
      timeframe,
      1000,
      months,
    );

    if (df.length === 0) {
      console.log("No data available.");
      return;
    }

    const startDate = new Date(df[0].timestamp).toLocaleDateString();
    const endDate = new Date(df[df.length - 1].timestamp).toLocaleDateString();

    console.log(`  Data range : ${startDate} → ${endDate}`);
    console.log(`  Total rows : ${df.length}`);

    const config = bot.get_config();
    // FIX #2: derive the history cap from the configured trend_period so that
    // MomentumBot's guard (`closes_history.length < trend_period`) can always
    // be satisfied. A buffer of 50 extra candles is added on top to give
    // RSI and other secondary indicators enough look-back room.
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
      // contains only prior (confirmed) candles. The bot receives the current
      // bar's OHLC through the dedicated parameters and must not derive
      // current_close from the tail of closes_history.
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
}
