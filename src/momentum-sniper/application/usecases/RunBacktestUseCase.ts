import { IMarketDataProvider } from "../../ports/IMarketDataProvider";
import { IReportGenerator } from "../../ports/IReportGenerator";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { BotConfig } from "../../../models/BotConfig";

export class RunBacktestUseCase {
  constructor(
    private marketDataProvider: IMarketDataProvider,
    private reportGenerator: IReportGenerator,
  ) {}

  async execute(
    config: BotConfig,
    outputPath: string,
    months: number = 6,
    timeframe: string = "1h",
  ): Promise<void> {
    console.log("=".repeat(60));
    console.log(" Momentum Sniper — Backtester (TS)");
    console.log("=".repeat(60));

    const symbol = config.symbol ?? "BTCUSDT";
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

    const bot = new MomentumBot(config);
    const closes: number[] = [];
    const volumes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];

    // Memory efficient loop
    console.log(`\n  Running backtest on ${df.length} candles...`);
    for (const row of df) {
      closes.push(row.close);
      volumes.push(row.volume);
      highs.push(row.high);
      lows.push(row.low);
      
      // Prevent memory leak by capping history arrays
      if (closes.length > 300) closes.shift();
      if (volumes.length > 300) volumes.shift();
      if (highs.length > 300) highs.shift();
      if (lows.length > 300) lows.shift();

      // IMPORTANT: Pass copies of arrays to ensure indicators use frozen history
      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        [...closes],
        [...volumes],
        [...highs],
        [...lows]
      );
    }

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

    this.reportGenerator.generateReport(df, bot, outputPath);
    console.log("\nDone.");
  }
}
