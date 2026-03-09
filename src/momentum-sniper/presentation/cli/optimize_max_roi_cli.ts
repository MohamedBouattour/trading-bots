import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { BotConfig } from "../../../models/BotConfig";

dotenv.config();

// ─────────────────────────────────────────────────────
//  MAX ROI Parameter Search Space
// ─────────────────────────────────────────────────────
const PARAM_GRID = {
  take_profit_pct: [2.0, 4.0, 6.0, 8.0, 10.0, 15.0],
  trend_period: [20, 50, 100, 200],
  stop_loss_pct: [2.0, 5.0, 10.0],
  trailing_stop_pct: [1.0, 3.0, 5.0],
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
}

function parseNumericSummary(val: string): number {
  return parseFloat(val.replace(/[^0-9.-]/g, ""));
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

  console.log("Loading market data...");
  const df = await marketDataProvider.getHistoricalData(
    symbolNormalized,
    timeframe,
    1000,
    6,
  );
  if (df.length === 0) return;

  console.log(`\n🚀 Hunting for MAXIMUM ROI (Unfiltered)...`);

  const results: OptResult[] = [];
  const MAX_SAMPLES = 100;

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
      max_exposure_pct: randomPick(PARAM_GRID.max_exposure_pct),
    };

    const bot = new MomentumBot(cfg);
    const closes: number[] = [];
    const volumes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    for (const row of df) {
      closes.push(row.close);
      volumes.push(row.volume);
      highs.push(row.high);
      lows.push(row.low);
      
      const limit = 300;
      if (closes.length > limit) closes.shift();
      if (volumes.length > limit) volumes.shift();
      if (highs.length > limit) highs.shift();
      if (lows.length > limit) lows.shift();

      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        closes,
        volumes,
        highs,
        lows
      );
    }

    const summary = bot.summary();
    const roi = parseNumericSummary(summary.roi_pct);
    const max_dd = parseNumericSummary(summary.max_drawdown_pct);

    if (roi !== 0) {
      results.push({
        config: cfg,
        roi,
        max_dd,
        ratio: max_dd > 0 ? roi / max_dd : roi,
        trades: summary.total_trades,
        final_value: parseNumericSummary(summary.final_value),
        profit: parseNumericSummary(summary.total_profit),
      });
    }

    if (i % 500 === 0)
      process.stdout.write(
        `  Progress: ${((i / MAX_SAMPLES) * 100).toFixed(0)}% — ${results.length} results found\r`,
      );
  }

  console.log(
    `\n\nOptimization complete! Tested ${MAX_SAMPLES} combinations.`,
  );

  results.sort((a, b) => b.roi - a.roi);

  const top = results.slice(0, 30);

  console.log("=".repeat(100));
  console.log(" TOP 30 MAXIMUM ROI (Unfiltered)");
  console.log("=".repeat(100));
  console.log(
    "  #  " +
      "ROI%     ".padEnd(10) +
      "DD%      ".padEnd(10) +
      "Trades   ".padEnd(10) +
      "Profit$  ".padEnd(10) +
      "TP%   ".padEnd(7) +
      "SL%   ".padEnd(7) +
      "Trail%".padEnd(7) +
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

  if (top.length > 0) {
    const best = top[0];
    console.log(`\n🚀 BEST ROI CONFIG:\n`);
    console.log(JSON.stringify(best.config, null, 2));
  }
}

main().catch(console.error);
