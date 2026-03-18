import * as dotenv from "dotenv";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { RsiSmaCrossoverBot } from "../../domain/bot/RsiSmaCrossoverBot";
import { BotConfig } from "../../../models/BotConfig";
import { IBot } from "../../domain/bot/IBot";

dotenv.config();

const SYMBOLS = [
  "PAXG/USDT",
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
  "SUI/USDT",
];

const TIMEFRAMES = ["15m", "30m", "1h", "2h", "4h"];
const MONTHS = parseInt(process.env.MONTHS || "12");

// Slightly reduced parameter grid to make 26x6 combinations practically executionable
const PARAM_GRID = {
  sl_pct: [1.0, 2.0, 3.0, 4.0],
  rr_ratios: [1.5, 2.0, 2.5, 3.0],
  rsi_threshold: [30, 40, 45, 50],
  trend_period: [50, 100, 200],
};

interface OptResult {
  symbol: string;
  tf: string;
  botType: string;
  config: BotConfig;
  roi: number;
  max_dd: number;
  ratio: number;
  trades: number;
  win_rate: number;
}

function parseNumericSummary(val: string): number {
  return parseFloat(val.replace(/[^0-9.-]/g, ""));
}

async function main() {
  const initialBalance = parseFloat(process.env.BALANCE || "1000.0");

  const apiProvider = new BinanceMarketDataProvider();
  const synthProvider = new SyntheticMarketDataProvider();

  console.log(`\n🔍 MASSIVE MULTI-BOT, MULTI-TIMEFRAME OPTIMIZATION`);
  console.log(
    `⏱️  Period: ${MONTHS} Months | Initial Balance: $${initialBalance}`,
  );
  console.log(
    `📈 Testing ${SYMBOLS.length} Symbols | 2 Bots | ${TIMEFRAMES.length} Timeframes`,
  );
  console.log("=".repeat(120));

  const allResults: OptResult[] = [];

  for (const asset of SYMBOLS) {
    const symbol = asset.replace("/", "").toUpperCase();
    console.log(`\n🚀 Testing Asset: ${asset}`);

    for (const tf of TIMEFRAMES) {
      process.stdout.write(`   📂 Fetching ${tf} data... `);
      const localFile = `${symbol.toLowerCase()}_${tf}.csv`;
      const marketDataProvider = new CompositeMarketDataProvider(
        new LocalCsvMarketDataProvider(localFile),
        apiProvider,
        synthProvider,
      );

      const df = await marketDataProvider.getHistoricalData(
        symbol,
        tf,
        1000,
        MONTHS,
      );
      if (df.length === 0) {
        console.log(`❌ No data`);
        continue;
      }
      console.log(`✅ Loaded ${df.length} candles. Optimizing...`);

      // Run combinations
      for (const sl of PARAM_GRID.sl_pct) {
        for (const rr of PARAM_GRID.rr_ratios) {
          const tp = sl * rr;
          for (const rsi of PARAM_GRID.rsi_threshold) {
            for (const trend of PARAM_GRID.trend_period) {
              const cfg: BotConfig = {
                symbol: symbol,
                initial_balance: initialBalance,
                trend_period: trend,
                take_profit_pct: tp,
                stop_loss_pct: sl,
                rsi_threshold: rsi,
                rsi_sma_period: 14, // standard param injected
                rsi_under_sma_duration: 5, // standard param injected
                max_exposure_pct: 100,
                fee_pct: 0.1,
              };

              // Benchmarking both bots simultaneously
              const botsToTest: {
                name: string;
                create: (c: BotConfig) => IBot;
              }[] = [
                { name: "Momentum", create: (c) => new MomentumBot(c) },
                { name: "SmaCross", create: (c) => new RsiSmaCrossoverBot(c) },
              ];

              for (const botDef of botsToTest) {
                const bot = botDef.create(cfg);
                const closes: number[] = [];
                for (const row of df) {
                  bot.on_candle(
                    row.timestamp,
                    row.open,
                    row.high,
                    row.low,
                    row.close,
                    closes,
                  );
                  closes.push(row.close);
                  if (closes.length > 300) closes.shift(); // Bound memory footprint
                }

                const lastRow = df[df.length - 1];
                bot.close_all_positions(lastRow.close, lastRow.timestamp);

                const summary = bot.summary();
                const roi = parseNumericSummary(summary.roi_pct);
                const max_dd = parseNumericSummary(summary.max_drawdown_pct);
                const trades = summary.total_trades;

                // Thresholds: Only care about setups that took at least 5 positions
                // and turned a positive ROI.
                if (trades >= 5 && roi > 0) {
                  allResults.push({
                    symbol: asset,
                    tf,
                    botType: botDef.name,
                    config: cfg,
                    roi,
                    max_dd,
                    ratio: max_dd > 0 ? roi / max_dd : 0,
                    trades,
                    win_rate: parseNumericSummary(summary.win_rate),
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // Sort by strictly total ROI % across all results
  allResults.sort((a, b) => b.roi - a.roi);

  console.log("\n" + "=".repeat(120));
  console.log(` 🏆 TOP 20 OPTIMAL CONFIGURATIONS ACROSS ALL ASSETS`);
  console.log("=".repeat(120));
  console.log(
    "  #  " +
      "Asset     ".padEnd(12) +
      "Bot       ".padEnd(12) +
      "TF    ".padEnd(6) +
      "ROI%      ".padEnd(10) +
      "Max DD%   ".padEnd(10) +
      "WR%    ".padEnd(8) +
      "Trades ".padEnd(8) +
      "TP%   ".padEnd(7) +
      "SL%   ".padEnd(7) +
      "RSI<  ".padEnd(7) +
      "Trend",
  );
  console.log("-".repeat(120));

  allResults.slice(0, 20).forEach((r, i) => {
    const c = r.config;
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
        `${r.symbol.padEnd(11)} ` +
        `${r.botType.padEnd(11)} ` +
        `${r.tf.padEnd(5)} ` +
        `${r.roi.toFixed(2).padStart(7)}%  ` +
        `${r.max_dd.toFixed(2).padStart(7)}%  ` +
        `${r.win_rate.toFixed(1).padStart(5)}%  ` +
        `${r.trades.toString().padStart(6)}  ` +
        `${(c.take_profit_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.stop_loss_pct ?? 0).toFixed(1).padStart(4)}  ` +
        `${(c.rsi_threshold ?? 0).toString().padStart(4)}  ` +
        `${(c.trend_period ?? 0).toString().padStart(5)}`,
    );
  });

  if (allResults.length > 0) {
    const best = allResults[0];
    console.log(`\n💎 BEST OVERALL SETTINGS:`);
    console.log(
      `Asset: ${best.symbol} | Timeframe: ${best.tf} | Bot: ${best.botType}`,
    );
    console.log(
      `ROI: ${best.roi.toFixed(2)}% | Win Rate: ${best.win_rate.toFixed(1)}% | DD: ${best.max_dd.toFixed(2)}% | Trades: ${best.trades}`,
    );
    console.log(JSON.stringify(best.config, null, 2));
  } else {
    console.log(
      "\n⚠️ No profitable configurations found matching minimum trade requirements.",
    );
  }
}

main().catch(console.error);
