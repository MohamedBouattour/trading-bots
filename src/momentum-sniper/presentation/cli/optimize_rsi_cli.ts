import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { BotConfig } from "../../../models/BotConfig";

dotenv.config();

const PARAM_GRID = {
  take_profit_pct: [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 15.0],
  stop_loss_pct: [2.0, 3.0, 4.0, 5.0, 6.0, 8.0],
  rsi_threshold: [30, 35, 40, 45, 50, 55, 60],
  trend_period: [100, 200, 300],
  trailing_stop_pct: [0.0, 1.0, 2.0, 3.0, 5.0],
  max_exposure_pct: [100],
};

interface OptResult {
  config: BotConfig;
  roi: number;
  max_dd: number;
  ratio: number;
  trades: number;
  final_value: number;
  profit: number;
  win_rate: number;
}

function parseNumericSummary(val: string): number {
  return parseFloat(val.replace(/[^0-9.-]/g, ""));
}

async function main() {
  const symbol = process.env.ASSET?.replace(/['"]/g, "") || "SOL/USDT";
  const initialBalance = parseFloat(process.env.BALANCE || "1000.0");
  const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "4h";
  const months = parseInt(process.env.MONTHS || "12");

  const symbolNormalized = symbol.replace("/", "").toUpperCase();
  const LOCAL_CSV = `${symbolNormalized.toLowerCase()}_${timeframe}.csv`;
  const localProvider = new LocalCsvMarketDataProvider(LOCAL_CSV);
  const apiProvider = new BinanceMarketDataProvider();
  const synthProvider = new SyntheticMarketDataProvider();
  const marketDataProvider = new CompositeMarketDataProvider(
    localProvider,
    apiProvider,
    synthProvider,
  );

  console.log(`Loading market data for ${symbolNormalized} ${timeframe}...`);
  const df = await marketDataProvider.getHistoricalData(
    symbolNormalized,
    timeframe,
    1000,
    months,
  );
  if (df.length === 0) {
      console.error("No data found.");
      return;
  }

  console.log(`\n🎯 Optimizing for consistent ~4% monthly profit (Target ROI > 48% for ${months} months)...`);

  const results: OptResult[] = [];
  const MAX_SAMPLES = 2000;

  function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const cfg: BotConfig = {
      symbol: symbolNormalized,
      initial_balance: initialBalance,
      trend_period: randomPick(PARAM_GRID.trend_period),
      take_profit_pct: randomPick(PARAM_GRID.take_profit_pct),
      stop_loss_pct: randomPick(PARAM_GRID.stop_loss_pct),
      trailing_stop_pct: randomPick(PARAM_GRID.trailing_stop_pct),
      rsi_threshold: randomPick(PARAM_GRID.rsi_threshold),
      max_exposure_pct: randomPick(PARAM_GRID.max_exposure_pct),
      fee_pct: 0.1,
    };

    const bot = new MomentumBot(cfg);
    const closes: number[] = [];
    const volumes: number[] = [];
    for (const row of df) {
      closes.push(row.close);
      volumes.push(row.volume);
      if (closes.length > 400) closes.shift();
      if (volumes.length > 400) volumes.shift();

      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        closes,
        volumes,
      );
    }

    const summary = bot.summary();
    const roi = parseNumericSummary(summary.roi_pct);
    const max_dd = parseNumericSummary(summary.max_drawdown_pct);
    const win_rate = parseNumericSummary(summary.win_rate);

    if (roi > 0 && max_dd > 0 && summary.total_trades >= 10) {
      const ratio = roi / max_dd;
      results.push({
        config: cfg,
        roi,
        max_dd,
        ratio,
        trades: summary.total_trades,
        final_value: parseNumericSummary(summary.final_value),
        profit: parseNumericSummary(summary.total_profit),
        win_rate,
      });
    }

    if (i % 200 === 0)
      process.stdout.write(
        `  Progress: ${((i / MAX_SAMPLES) * 100).toFixed(0)}% — ${results.length} valid combos found\r`,
      );
  }

  console.log(
    `\n\nOptimization complete! Found ${results.length} profitable combinations.`,
  );

  // Filter for ROI > 40% (close to 4% monthly) and Sort by ROI/DD Ratio
  const quality = results.filter(r => r.roi > 30); // At least some profit
  quality.sort((a, b) => b.ratio - a.ratio);

  const top = quality.slice(0, 20);

  console.log("=".repeat(110));
  console.log(" TOP 20 CONSISTENT STRATEGIES (Sorted by ROI/DD Ratio)");
  console.log("=".repeat(110));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(10) +
      "DD%      ".padEnd(10) +
      "Ratio    ".padEnd(10) +
      "WR%   ".padEnd(7) +
      "Trades ".padEnd(8) +
      "TP%   ".padEnd(7) +
      "SL%   ".padEnd(7) +
      "RSI<  ".padEnd(7) +
      "Trail%".padEnd(7) +
      "TrPrd".padEnd(7),
  );
  console.log("-".repeat(110));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const c = r.config;
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
        `${r.roi.toFixed(2).padStart(7)}%  ` +
        `${r.max_dd.toFixed(2).padStart(7)}%  ` +
        `${r.ratio.toFixed(2).padStart(7)}x  ` +
        `${r.win_rate.toFixed(1).padStart(4)}%  ` +
        `${r.trades.toString().padStart(6)}   ` +
        `${(c.take_profit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.rsi_threshold ?? 0).toString().padStart(4)}  ` +
        `${(c.trailing_stop_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(4)}`,
    );
  }

  if (top.length > 0) {
    const best = top[0];
    console.log(`\n🏆 BEST BALANCED STRATEGY (Highest ROI/DD Ratio):\n`);
    console.log(JSON.stringify(best.config, null, 2));
    console.log(`\nPerformance: ROI: ${best.roi.toFixed(2)}%, Max DD: ${best.max_dd.toFixed(2)}%, Win Rate: ${best.win_rate.toFixed(2)}%`);
  }
}

main().catch(console.error);
