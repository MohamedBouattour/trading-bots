import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";

dotenv.config();

// ─────────────────────────────────────────────────────
//  WIDE SEARCH SPACE - Focus on Maximum ROI
// ─────────────────────────────────────────────────────
const PARAM_GRID = {
  grid_density: [10, 20, 35, 50, 75, 100],
  take_profit_pct: [0.4, 0.8, 1.5, 3.0, 5.0, 8.0, 15.0],
  volatility_lookback: [24, 48, 72, 120],
  trend_period: [14, 24, 50, 100, 200],
  trend_threshold: [0.0001, 0.0005, 0.001, 0.002],
  martingale_factor: [1.0, 1.15, 1.5, 2.0, 3.0],
  stop_loss_pct: [0, 2.0, 5.0, 15.0, 30.0],
  trailing_stop_pct: [0, 1.5, 3.0, 6.0, 12.0],
  max_exposure_pct: [20, 40, 60, 80, 100],
  max_drawdown_exit_pct: [5.0, 10.0, 20.0, 40.0, 60.0, 0], // 0 means no emergency exit
};

interface OptResult {
  config: GridStrategyConfig;
  roi: number;
  max_dd: number;
  ratio: number;
  trades: number;
  final_value: number;
  profit: number;
}

function parseNumericSummary(val: string): number {
  return parseFloat(val.replace(/[^0-9.-]/g, ""));
}

async function main() {
  const symbol = process.env.ASSET?.replace(/['"]/g, "") || "BTCUSDT";
  const initialBalance = parseFloat(process.env.BALANCE || "500");
  const timeframe = "1h";

  const symbolClean = symbol
    .replace(/['"]/g, "")
    .replace("/", "")
    .toLowerCase();
  const LOCAL_CSV = `${symbolClean}_1h.csv`;
  const localProvider = new LocalCsvMarketDataProvider(LOCAL_CSV);
  const apiProvider = new BinanceMarketDataProvider();
  const synthProvider = new SyntheticMarketDataProvider();
  const marketDataProvider = new CompositeMarketDataProvider(
    localProvider,
    apiProvider,
    synthProvider,
  );

  console.log("Loading market data...");
  const df = await marketDataProvider.getHistoricalData(
    symbol.replace("/", ""),
    timeframe,
    1000,
    6,
  );
  if (df.length === 0) {
    console.log("Error: No data loaded.");
    return;
  }

  const startDate = new Date(df[0].timestamp).toLocaleDateString();
  const endDate = new Date(df[df.length - 1].timestamp).toLocaleDateString();
  console.log(`\n🚀 WIDE OPTIMIZATION: Maximize ROI on 6 Months Backtest`);
  console.log(`📊 Period: ${startDate} to ${endDate} (${df.length} candles)`);
  console.log(`💰 Capital: $${initialBalance}\n`);

  const results: OptResult[] = [];
  const MAX_SAMPLES = 5000; // Quick wide search

  function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  console.log(`🛠️  Running ${MAX_SAMPLES} random combinations...`);

  for (let i = 0; i < MAX_SAMPLES; i++) {
    const cfg: GridStrategyConfig = {
      symbol,
      initial_balance: initialBalance,
      grid_density: randomPick(PARAM_GRID.grid_density),
      qty_per_order: 0.0,
      volatility_lookback: randomPick(PARAM_GRID.volatility_lookback),
      trend_period: randomPick(PARAM_GRID.trend_period),
      trend_threshold: randomPick(PARAM_GRID.trend_threshold),
      take_profit_pct: randomPick(PARAM_GRID.take_profit_pct),
      stop_loss_pct: randomPick(PARAM_GRID.stop_loss_pct),
      trailing_stop_pct: randomPick(PARAM_GRID.trailing_stop_pct),
      martingale_factor: randomPick(PARAM_GRID.martingale_factor),
      max_exposure_pct: randomPick(PARAM_GRID.max_exposure_pct),
      max_drawdown_exit_pct: randomPick(PARAM_GRID.max_drawdown_exit_pct),
    };

    const bot = new SmartGridBot(cfg);
    const closes: number[] = [];
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

    const summary = bot.summary();
    const roi = parseNumericSummary(summary.roi_pct);
    const max_dd = parseNumericSummary(summary.max_drawdown_pct);

    if (roi > 0 && max_dd > 0) {
      results.push({
        config: cfg,
        roi,
        max_dd,
        ratio: roi / max_dd,
        trades: summary.total_trades,
        final_value: parseNumericSummary(summary.final_value),
        profit: parseNumericSummary(summary.total_profit),
      });
    }

    if (i % 2500 === 0 && i > 0) {
      process.stdout.write(
        `  Progress: ${((i / MAX_SAMPLES) * 100).toFixed(0)}% — ${results.length} profitable combinations found\r`,
      );
    }
  }

  console.log(
    `\n\n✅ Optimization complete! Tested ${MAX_SAMPLES} combinations.`,
  );
  console.log(`📈 Profitable combinations: ${results.length}`);

  // ── SORT BY ROI (HIGHEST PROFIT FIRST) ──
  results.sort((a, b) => b.roi - a.roi);

  const top = results.slice(0, 30);

  console.log("=".repeat(165));
  console.log(" TOP 30 STRATEGIES BY ROI (6-MONTH BACKTEST)");
  console.log("=".repeat(165));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(12) +
      "Profit$  ".padEnd(12) +
      "DD%      ".padEnd(10) +
      "Ratio    ".padEnd(10) +
      "Trades   ".padEnd(10) +
      "Grid  ".padEnd(7) +
      "TP%   ".padEnd(7) +
      "Mart  ".padEnd(7) +
      "MaxExp".padEnd(7) +
      "SL%   ".padEnd(7) +
      "Trail%".padEnd(7) +
      "TrPrd ".padEnd(7) +
      "MaxDDX".padEnd(7),
  );
  console.log("-".repeat(165));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const c = r.config;
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
        `${r.roi.toFixed(2).padStart(8)}%   ` +
        `${r.profit.toFixed(2).padStart(9)}   ` +
        `${r.max_dd.toFixed(2).padStart(7)}%  ` +
        `${r.ratio.toFixed(2).padStart(7)}x  ` +
        `${r.trades.toString().padStart(6)}   ` +
        `${(c.grid_density ?? 0).toString().padStart(4)}  ` +
        `${(c.take_profit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.martingale_factor ?? 0).toFixed(2).padStart(5)}  ` +
        `${(c.max_exposure_pct ?? 0).toString().padStart(4)}  ` +
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trailing_stop_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(4)}  ` +
        `${(c.max_drawdown_exit_pct ?? 0).toFixed(0).padStart(4)}`,
    );
  }
  console.log("=".repeat(165));

  if (top.length > 0) {
    const best = top[0];
    console.log(`\n🏆 BEST ROI CONFIGURATION FOUND:\n`);
    console.log(JSON.stringify(best.config, null, 2));

    console.log(`\n💰 Expected ROI: ${best.roi.toFixed(2)}%`);
    console.log(`📉 Max Drawdown: ${best.max_dd.toFixed(2)}%`);
    console.log(`📊 ROI/DD Ratio: ${best.ratio.toFixed(2)}x`);
  }
}

main().catch(console.error);
