import * as dotenv from "dotenv";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { MultiHtmlReportGenerator } from "../../infrastructure/reporting/MultiHtmlReportGenerator";
import {
  TrendRiderBot,
  FixedTargetBot,
  DeepValueBot,
  PullbackRiderBot,
  VolatilitySwingBot,
  StructuralGridBot,
} from "../../domain/bot/StrategyBots";
import { BotConfig } from "../../../models/BotConfig";

dotenv.config();

const symbol = "BTCUSDT";
const timeframe = "4h";
const LOCAL_CSV = `btcusdt_4h.csv`;
const OUTPUT_HTML = "smart_backtest_results.html";

async function main() {
  console.log(`🚀 Benchmarking 6 strategies for ${symbol}...`);
  console.log(`📁 Source: ${LOCAL_CSV}`);

  const localProvider = new LocalCsvMarketDataProvider(LOCAL_CSV);
  const apiProvider = new BinanceMarketDataProvider();
  const synthProvider = new SyntheticMarketDataProvider();
  const marketDataProvider = new CompositeMarketDataProvider(
    localProvider,
    apiProvider,
    synthProvider,
  );

  const df = await marketDataProvider.getHistoricalData(
    symbol,
    timeframe,
    1000,
    12,
  );
  if (df.length === 0) {
    console.error("No data found!");
    return;
  }

  const initial_balance = 1000.0;
  const config: BotConfig = {
    symbol,
    initial_balance,
    fee_pct: 0.1,
  };

  const bots = [
    { name: "Trend Rider", bot: new TrendRiderBot(config) },
    { name: "Fixed Target", bot: new FixedTargetBot(config) },
    { name: "Deep Value", bot: new DeepValueBot(config) },
    { name: "Pullback Rider", bot: new PullbackRiderBot(config) },
    { name: "Volatility Swing", bot: new VolatilitySwingBot(config) },
    { name: "Structural Grid", bot: new StructuralGridBot(config) },
  ];

  for (const { name, bot } of bots) {
    console.log(`\n  Running backtest for ${name}...`);
    const historyCap = 350;
    const closes: number[] = [];
    const volumes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];

    for (const row of df) {
      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        [...closes],
        [...volumes],
        [...highs],
        [...lows],
      );
      closes.push(row.close);
      volumes.push(row.volume);
      highs.push(row.high);
      lows.push(row.low);
      if (closes.length > historyCap) {
        closes.shift();
        volumes.shift();
        highs.shift();
        lows.shift();
      }
    }
    bot.close_all_positions(
      df[df.length - 1].close,
      df[df.length - 1].timestamp,
    );
    console.log(`  Done. Profit: ${bot.summary().total_profit}`);
  }

  const reportGenerator = new MultiHtmlReportGenerator();
  reportGenerator.generateReport(df, bots, OUTPUT_HTML);
  console.log(`\n✅ Combined report generated: ${OUTPUT_HTML}`);
}

main().catch(console.error);
