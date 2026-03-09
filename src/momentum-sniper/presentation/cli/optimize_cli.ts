import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { BotConfig } from "../../../models/BotConfig";

dotenv.config();

// ─────────────────────────────────────────────────────
//  Parameter Search Space (with new risk management params)
// ─────────────────────────────────────────────────────
const SEARCH_SPACE = {
  take_profit_pct: [2.0, 5.0, 10.0, 15.0, 20.0],
  stop_loss_pct: [2.0, 5.0, 10.0],
  trend_period: [50, 100, 200],
  trailing_stop_pct: [0, 2.0, 5.0],
  max_exposure_pct: [50, 100],
};

interface OptResult {
  config: BotConfig;
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
  for (const vals of Object.values(SEARCH_SPACE)) {
    total *= vals.length;
  }
  return total;
}

async function main() {
  const symbol = process.env.ASSET?.replace(/['"]/g, "") || "SOL/USDT";
  const initialBalance = parseFloat(process.env.BALANCE || "631.38");
  const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "1h";

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

  console.log(`Loading market data for ${symbolNormalized}...`);
  const df = await marketDataProvider.getHistoricalData(
    symbolNormalized,
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

  console.log("  Running optimization...\n");

  const results: OptResult[] = [];
  let tested = 0;

  function runBot(cfg: BotConfig): void {
    const bot = new MomentumBot(cfg);
    const closes: number[] = [];
    const volumes: number[] = [];

    for (const row of df) {
      closes.push(row.close);
      volumes.push(row.volume);
      if (closes.length > 300) closes.shift();
      if (volumes.length > 300) volumes.shift();

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
    const trades = summary.total_trades;
    const final_value = parseNumericSummary(summary.final_value);
    const profit = parseNumericSummary(summary.total_profit);

    if (roi !== 0) {
      results.push({
        config: cfg,
        roi,
        max_dd,
        ratio: max_dd > 0 ? roi / max_dd : roi,
        trades,
        final_value,
        profit,
      });
    }

    tested++;
  }

  // Full grid search
  for (const tp of PARAM_GRID.take_profit_pct) {
    for (const sl of PARAM_GRID.stop_loss_pct) {
      for (const tpd of PARAM_GRID.trend_period) {
        for (const ts of PARAM_GRID.trailing_stop_pct) {
          for (const me of PARAM_GRID.max_exposure_pct) {
            const cfg: BotConfig = {
              symbol: symbolNormalized,
              initial_balance: initialBalance,
              trend_period: tpd,
              take_profit_pct: tp,
              stop_loss_pct: sl,
              trailing_stop_pct: ts,
              max_exposure_pct: me,
            };
            runBot(cfg);
            process.stdout.write(
              `  Progress: ${((tested / total) * 100).toFixed(0)}% (${tested}/${total})  — ${results.length} results\r`,
            );
          }
        }
      }
    }
  }

  console.log(`\n\n  Optimization complete! Tested ${tested} combinations.`);
  console.log(`  Valid results: ${results.length}\n`);

  results.sort((a, b) => b.roi - a.roi);

  const top = results.slice(0, 20);

  console.log("=".repeat(100));
  console.log(" TOP 20 PARAMETER COMBINATIONS (sorted by ROI)");
  console.log("=".repeat(100));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(10) +
      "DD%      ".padEnd(10) +
      "Trades   ".padEnd(10) +
      "Profit$  ".padEnd(10) +
      "TP%   ".padEnd(7) +
      "SL%   ".padEnd(7) +
      "Trail ".padEnd(7) +
      "TrPrd ".padEnd(7),
  );
  console.log("-".repeat(100));

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const c = r.config;
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
        `${r.roi.toFixed(2).padStart(7)}%  ` +
        `${r.max_dd.toFixed(2).padStart(7)}%  ` +
        `${r.trades.toString().padStart(6)}   ` +
        `${r.profit.toFixed(2).padStart(8)}  ` +
        `${(c.take_profit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trailing_stop_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(4)}`,
    );
  }

  console.log("=".repeat(100));
}

main().catch(console.error);
