import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";

dotenv.config();

// ─────────────────────────────────────────────────────
//  SWEET SPOT Parameter Search Space
// ─────────────────────────────────────────────────────
const PARAM_GRID = {
  grid_density: [20, 35, 50, 70],
  take_profit_pct: [1.5, 2.5, 4.0, 6.0, 8.0],
  volatility_lookback: [48, 72, 96],
  trend_period: [14, 24, 72],
  trend_threshold: [0.0002, 0.0006, 0.0012],
  martingale_factor: [1.2, 1.5, 2.0, 2.5],
  stop_loss_pct: [0, 5.0, 10.0, 15.0],
  trailing_stop_pct: [0, 2.0, 4.0, 6.0],
  max_exposure_pct: [80, 100],
  max_drawdown_exit_pct: [10.0, 15.0, 20.0],
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

  const LOCAL_CSV = "btcusdt_1h.csv";
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
  if (df.length === 0) return;

  console.log(`\n🎯 Hunting for the "Sweet Spot" (ROI = 2x to 5x DD)...`);

  const results: OptResult[] = [];
  const MAX_SAMPLES = 20000;

  function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

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
      const ratio = roi / max_dd;
      // Filter for the Sweet Spot: 2.0 <= Ratio <= 5.0
      if (ratio >= 2.0 && ratio <= 6.0) {
        results.push({
          config: cfg,
          roi,
          max_dd,
          ratio,
          trades: summary.total_trades,
          final_value: parseNumericSummary(summary.final_value),
          profit: parseNumericSummary(summary.total_profit),
        });
      }
    }

    if (i % 1000 === 0)
      process.stdout.write(
        `  Progress: ${((i / MAX_SAMPLES) * 100).toFixed(0)}% — ${results.length} sweet-spot combos found\r`,
      );
  }

  console.log(
    `\n\nOptimization complete! Found ${results.length} combinations in the sweet spot.`,
  );

  // ── SORT BY ROI (HIGHEST PROFIT FIRST) ──
  results.sort((a, b) => b.roi - a.roi);

  const top = results.slice(0, 30);

  console.log("=".repeat(155));
  console.log(" TOP 30 HIGH-PROFIT SWEET SPOT (2x-5x Ratio)");
  console.log("=".repeat(155));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(10) +
      "DD%      ".padEnd(10) +
      "Ratio    ".padEnd(10) +
      "Trades   ".padEnd(10) +
      "Profit$  ".padEnd(10) +
      "Grid  ".padEnd(7) +
      "TP%   ".padEnd(7) +
      "Mart  ".padEnd(7) +
      "MaxExp".padEnd(7) +
      "SL%   ".padEnd(7) +
      "Trail%".padEnd(7) +
      "TrPrd ".padEnd(7),
  );
  console.log("-".repeat(155));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const c = r.config;
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
        `${r.roi.toFixed(2).padStart(7)}%  ` +
        `${r.max_dd.toFixed(2).padStart(7)}%  ` +
        `${r.ratio.toFixed(2).padStart(7)}x  ` +
        `${r.trades.toString().padStart(6)}   ` +
        `${r.profit.toFixed(2).padStart(8)}  ` +
        `${(c.grid_density ?? 0).toString().padStart(4)}  ` +
        `${(c.take_profit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.martingale_factor ?? 0).toFixed(2).padStart(5)}  ` +
        `${(c.max_exposure_pct ?? 0).toString().padStart(4)}  ` +
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trailing_stop_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(4)}`,
    );
  }

  if (top.length > 0) {
    const best = top[0];
    console.log(`\n🏆 BEST ROI SWEET SPOT:\n`);
    console.log(JSON.stringify(best.config, null, 2));
  }
}

main().catch(console.error);
