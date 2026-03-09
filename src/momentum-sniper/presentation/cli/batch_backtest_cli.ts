import * as dotenv from "dotenv";
import { RunBacktestUseCase } from "../../application/usecases/RunBacktestUseCase";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { HtmlReportGenerator } from "../../infrastructure/reporting/HtmlReportGenerator";
import { BotConfig } from "../../../models/BotConfig";
import { MomentumBot } from "../../domain/bot/MomentumBot";

dotenv.config();

const SYMBOLS = [
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", 
  "ADA/USDT", "AVAX/USDT", "DOGE/USDT", "SHIB/USDT", "DOT/USDT",
  "LINK/USDT", "MATIC/USDT", "UNI/USDT", "NEAR/USDT", "LTC/USDT",
  "ICP/USDT", "PEPE/USDT", "RENDER/USDT", "FET/USDT", "STX/USDT",
  "APT/USDT", "ARB/USDT", "OP/USDT", "TIA/USDT", "SUI/USDT"
];

async function runSingle(symbol: string, timeframe: string, months: number) {
  const symbolClean = symbol.replace("/", "");
  const config: BotConfig = {
    symbol: symbolClean,
    initial_balance: 1000.0,
    trend_period: 100,
    take_profit_pct: 12.0,
    stop_loss_pct: 6.0,
    rsi_threshold: 45.0,
    max_exposure_pct: 100.0,
    fee_pct: 0.1,
    move_sl_to_be_at_pct: 8.0
  };

  const localFile = `${symbolClean.toLowerCase()}_${timeframe}.csv`;
  const marketDataProvider = new CompositeMarketDataProvider(
    new LocalCsvMarketDataProvider(localFile),
    new BinanceMarketDataProvider(),
    new SyntheticMarketDataProvider()
  );

  const df = await marketDataProvider.getHistoricalData(symbolClean, timeframe, 1000, months);
  if (df.length === 0) return null;

  const bot = new MomentumBot(config);
  const closes: number[] = [];
  for (const row of df) {
    closes.push(row.close);
    if (closes.length > 200) closes.shift();
    bot.on_candle(row.timestamp, row.open, row.high, row.low, row.close, closes);
  }

  const summary = bot.summary();
  return {
    symbol,
    roi: parseFloat(summary.roi_pct.replace("%", "")),
    drawdown: parseFloat(summary.max_drawdown_pct.replace("%", "")),
    trades: summary.total_trades,
    winRate: parseFloat(summary.win_rate.replace("%", ""))
  };
}

async function main() {
  const timeframe = "4h";
  const months = 12;
  console.log(`\n🏆 STARTING TOP 25 CRYPTO BATCH BACKTEST (Strategy: RSI Pullback 4h)`);
  console.log(`⏱️  Timeframe: ${timeframe} | Period: ${months} Months`);
  console.log("=".repeat(60));

  const results = [];
  for (const sym of SYMBOLS) {
    process.stdout.write(`Testing ${sym.padEnd(10)}... `);
    try {
      const res = await runSingle(sym, timeframe, months);
      if (res) {
        results.push(res);
        console.log(`✅ ROI: ${res.roi.toFixed(2)}% | DD: ${res.drawdown.toFixed(2)}%`);
      } else {
        console.log(`❌ No Data`);
      }
    } catch (err) {
      console.log(`❌ Error`);
    }
  }

  results.sort((a, b) => b.roi - a.roi);

  console.log("\n" + "=".repeat(80));
  console.log(" TOP 25 CRYPTO LEADERBOARD (4h RSI Pullback)");
  console.log("=".repeat(80));
  console.log(
    "  #  " +
    "Symbol     ".padEnd(12) +
    "ROI%       ".padEnd(12) +
    "Max DD%    ".padEnd(12) +
    "WR%        ".padEnd(10) +
    "Trades"
  );
  console.log("-".repeat(80));

  results.forEach((r, i) => {
    console.log(
      `  ${(i + 1).toString().padStart(2)} ` +
      `${r.symbol.padEnd(11)} ` +
      `${r.roi.toFixed(2).padStart(8)}%  ` +
      `${r.drawdown.toFixed(2).padStart(8)}%  ` +
      `${r.winRate.toFixed(1).padStart(7)}%  ` +
      `${r.trades.toString().padStart(6)}`
    );
  });
  console.log("=".repeat(80));
}

main().catch(console.error);
