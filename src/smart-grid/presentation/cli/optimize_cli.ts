import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";

dotenv.config();

// ─────────────────────────────────────────────────────
//  Parameter Search Space (with new risk management params)
// ─────────────────────────────────────────────────────
const PARAM_GRID = {
  grid_density: [15, 20, 30, 40],
  take_profit_pct: [0.5, 0.8, 1.0, 1.5, 2.0],
  volatility_lookback: [24, 48, 72],
  trend_period: [14, 24, 50],
  trend_threshold: [0.0003, 0.0006, 0.001],
  martingale_factor: [1.0, 1.1, 1.15],
  stop_loss_pct: [0, 2.0, 3.0, 5.0],
  trailing_stop_pct: [0, 1.5, 2.0, 3.0],
  max_exposure_pct: [30, 50, 70],
  max_drawdown_exit_pct: [3.0, 5.0, 8.0],
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

// Compute total combinations
function totalCombinations(): number {
  let total = 1;
  for (const vals of Object.values(PARAM_GRID)) {
    total *= vals.length;
  }
  return total;
}

async function main() {
  const symbol = process.env.ASSET?.replace(/['"]/g, "") || "BTCUSDT";
  const initialBalance = parseFloat(process.env.BALANCE || "500");
  const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "1h";

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

  if (df.length === 0) {
    console.log("No data available.");
    return;
  }

  const startDate = new Date(df[0].timestamp).toLocaleDateString();
  const endDate = new Date(df[df.length - 1].timestamp).toLocaleDateString();
  console.log(`  Data: ${df.length} candles from ${startDate} to ${endDate}`);

  const total = totalCombinations();
  console.log(`\n  Total combinations: ${total}`);

  // If too many combos, use random sampling
  const MAX_COMBOS = 10000;
  const useSampling = total > MAX_COMBOS;

  if (useSampling) {
    console.log(`  ⚡ Using random sampling (${MAX_COMBOS} of ${total})`);
  }
  console.log("  Running optimization...\n");

  const results: OptResult[] = [];
  let tested = 0;

  function runBot(cfg: GridStrategyConfig): void {
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
    const trades = summary.total_trades;
    const final_value = parseNumericSummary(summary.final_value);
    const profit = parseNumericSummary(summary.total_profit);

    if (roi > 0 && max_dd > 0) {
      results.push({
        config: cfg,
        roi,
        max_dd,
        ratio: roi / max_dd,
        trades,
        final_value,
        profit,
      });
    }

    tested++;
  }

  function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const targetTests = useSampling ? MAX_COMBOS : total;
  const progressStep = Math.max(1, Math.floor(targetTests / 20));

  if (useSampling) {
    // Random sampling
    for (let i = 0; i < MAX_COMBOS; i++) {
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
      runBot(cfg);
      if (tested % progressStep === 0) {
        process.stdout.write(
          `  Progress: ${((tested / MAX_COMBOS) * 100).toFixed(0)}% (${tested}/${MAX_COMBOS})  — ${results.length} profitable\r`,
        );
      }
    }
  } else {
    // Full grid search
    for (const gd of PARAM_GRID.grid_density) {
      for (const tp of PARAM_GRID.take_profit_pct) {
        for (const vl of PARAM_GRID.volatility_lookback) {
          for (const tpd of PARAM_GRID.trend_period) {
            for (const tt of PARAM_GRID.trend_threshold) {
              for (const mf of PARAM_GRID.martingale_factor) {
                for (const sl of PARAM_GRID.stop_loss_pct) {
                  for (const ts of PARAM_GRID.trailing_stop_pct) {
                    for (const me of PARAM_GRID.max_exposure_pct) {
                      for (const mde of PARAM_GRID.max_drawdown_exit_pct) {
                        const cfg: GridStrategyConfig = {
                          symbol,
                          initial_balance: initialBalance,
                          grid_density: gd,
                          qty_per_order: 0.0,
                          volatility_lookback: vl,
                          trend_period: tpd,
                          trend_threshold: tt,
                          take_profit_pct: tp,
                          stop_loss_pct: sl,
                          trailing_stop_pct: ts,
                          martingale_factor: mf,
                          max_exposure_pct: me,
                          max_drawdown_exit_pct: mde,
                        };
                        runBot(cfg);
                        if (tested % progressStep === 0) {
                          process.stdout.write(
                            `  Progress: ${((tested / total) * 100).toFixed(0)}% (${tested}/${total})  — ${results.length} profitable\r`,
                          );
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`\n\n  Optimization complete! Tested ${tested} combinations.`);
  console.log(`  Profitable combinations: ${results.length}\n`);

  // Sort by ratio, filter minimum trades
  const MIN_TRADES = 10;
  const filtered = results.filter((r) => r.trades >= MIN_TRADES);
  console.log(
    `  After filtering (min ${MIN_TRADES} trades): ${filtered.length} combos\n`,
  );

  filtered.sort((a, b) => b.ratio - a.ratio);

  const top = filtered.slice(0, 25);

  console.log("=".repeat(150));
  console.log(" TOP 25 PARAMETER COMBINATIONS (sorted by ROI/Drawdown ratio)");
  console.log("=".repeat(150));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(10) +
      "DD%      ".padEnd(10) +
      "Ratio    ".padEnd(10) +
      "Trades   ".padEnd(10) +
      "Profit$  ".padEnd(10) +
      "Grid  ".padEnd(7) +
      "TP%   ".padEnd(7) +
      "SL%   ".padEnd(7) +
      "Trail ".padEnd(7) +
      "MaxExp".padEnd(7) +
      "MaxDD ".padEnd(7) +
      "VolLB ".padEnd(7) +
      "TrPrd ".padEnd(7) +
      "TrThr    ".padEnd(10) +
      "Mart  ".padEnd(7),
  );
  console.log("-".repeat(150));

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
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trailing_stop_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.max_exposure_pct ?? 0).toString().padStart(4)}  ` +
        `${(c.max_drawdown_exit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.volatility_lookback ?? 0).toString().padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(4)}  ` +
        `${(c.trend_threshold ?? 0).toFixed(4).padStart(8)}  ` +
        `${(c.martingale_factor ?? 0).toFixed(2).padStart(5)}`,
    );
  }

  console.log("=".repeat(150));

  if (top.length > 0) {
    const best = top[0];
    console.log("\n" + "=".repeat(60));
    console.log("  🏆 BEST CONFIGURATION");
    console.log("=".repeat(60));
    console.log(`  ROI:              ${best.roi.toFixed(2)}%`);
    console.log(`  Max Drawdown:     ${best.max_dd.toFixed(2)}%`);
    console.log(
      `  ROI/DD Ratio:     ${best.ratio.toFixed(2)}x  ${best.ratio >= 3 ? "✅ TARGET MET!" : "⚠️  Below 3x target"}`,
    );
    console.log(`  Trades:           ${best.trades}`);
    console.log(`  Profit:           $${best.profit.toFixed(2)}`);
    console.log(`  Final Value:      $${best.final_value.toFixed(2)}`);
    console.log("-".repeat(60));
    console.log(`  grid_density:          ${best.config.grid_density}`);
    console.log(`  take_profit_pct:       ${best.config.take_profit_pct}`);
    console.log(`  stop_loss_pct:         ${best.config.stop_loss_pct}`);
    console.log(`  trailing_stop_pct:     ${best.config.trailing_stop_pct}`);
    console.log(`  max_exposure_pct:      ${best.config.max_exposure_pct}`);
    console.log(
      `  max_drawdown_exit_pct: ${best.config.max_drawdown_exit_pct}`,
    );
    console.log(`  volatility_lookback:   ${best.config.volatility_lookback}`);
    console.log(`  trend_period:          ${best.config.trend_period}`);
    console.log(`  trend_threshold:       ${best.config.trend_threshold}`);
    console.log(`  martingale_factor:     ${best.config.martingale_factor}`);
    console.log("=".repeat(60));

    console.log("\n  📋 Ready-to-paste CONFIG for backtest_cli.ts:\n");
    console.log(`const CONFIG: GridStrategyConfig = {`);
    console.log(`  symbol: "${best.config.symbol}",`);
    console.log(`  initial_balance: ${best.config.initial_balance},`);
    console.log(`  grid_density: ${best.config.grid_density},`);
    console.log(`  qty_per_order: 0.0,`);
    console.log(`  volatility_lookback: ${best.config.volatility_lookback},`);
    console.log(`  trend_period: ${best.config.trend_period},`);
    console.log(`  trend_threshold: ${best.config.trend_threshold},`);
    console.log(`  take_profit_pct: ${best.config.take_profit_pct},`);
    console.log(`  stop_loss_pct: ${best.config.stop_loss_pct},`);
    console.log(`  trailing_stop_pct: ${best.config.trailing_stop_pct},`);
    console.log(`  martingale_factor: ${best.config.martingale_factor},`);
    console.log(`  max_exposure_pct: ${best.config.max_exposure_pct},`);
    console.log(
      `  max_drawdown_exit_pct: ${best.config.max_drawdown_exit_pct},`,
    );
    console.log(`};`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
