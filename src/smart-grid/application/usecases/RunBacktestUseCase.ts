import { IMarketDataProvider } from "../../ports/IMarketDataProvider";
import { IReportGenerator } from "../../ports/IReportGenerator";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";

export class RunBacktestUseCase {
  constructor(
    private marketDataProvider: IMarketDataProvider,
    private reportGenerator: IReportGenerator,
  ) {}

  async execute(
    config: GridStrategyConfig,
    outputPath: string,
    months: number = 6,
    timeframe: string = "1h",
  ): Promise<void> {
    console.log("=".repeat(60));
    console.log(" Smart Grid Trading Bot — Backtester (TS)");
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

    const bot = new SmartGridBot(config);
    const closes: number[] = [];

    console.log(`\n  Running backtest on ${df.length} candles...`);
    for (const row of df) {
      closes.push(row.close);
      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        closes,
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
