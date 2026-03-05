import * as dotenv from "dotenv";
import * as path from "path";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";

dotenv.config({ path: path.join(__dirname, "../../../../.env") });

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.warn(`Missing environment variable: ${key}`);
    return "";
  }
  return val;
}

const apiKey = getEnv("API_KEY");
const apiSecret = getEnv("SECRET_KEY");
const symbol = process.env.ASSET || "BTC/USDT";
const symbolNormalized = symbol.replace(/['"/]/g, "");
const balanceToUse = parseFloat(process.env.BALANCE || "500");

async function main() {
  console.log(
    `[${new Date().toISOString()}] Starting Smart Grid Bot Cron Execution...`,
  );

  if (!apiKey || !apiSecret) {
    console.warn(
      "API credentials missing. Execution will be simulated or fail if interacting with Binance.",
    );
  }

  const marketData = new BinanceMarketDataProvider();
  const executor = new BinanceOrderExecutionService(
    apiKey || "dummy",
    apiSecret || "dummy",
  );

  // 1. Scan latest candles
  console.log(`Fetching latest 100 hourly candles for ${symbolNormalized}...`);
  const candles = await marketData.getHistoricalData(
    symbolNormalized,
    "1h",
    100,
    1,
  );
  if (candles.length === 0) {
    console.log("No candles retrieved. Exiting execution.");
    return;
  }

  const lastCandle = candles[candles.length - 1];
  console.log(
    `Latest candle: Close=${lastCandle.close}, High=${lastCandle.high}, Low=${lastCandle.low}`,
  );

  // 2. Scan current positions (Mock or fetch from your Binance client directly)
  // E.g., const accountInfo = await executor['client'].accountInfo();
  console.log(
    `Scanning current positions... (this would be queried from API in production)`,
  );

  // 3. Take a decision
  // Let's instantiate SmartGridBot and run it with recent history to recover state
  const bot = new SmartGridBot({
    symbol: symbolNormalized,
    initial_balance: balanceToUse,
    grid_density: parseFloat(process.env.GRID_DENSITY || "100"),
    take_profit_pct: parseFloat(process.env.TAKE_PROFIT || "0.8"),
    qty_per_order: parseFloat(process.env.QTY_PER_ORDER || "0.0"), // 0 means dynamic sizing
    volatility_lookback: parseInt(process.env.VOLATILITY_LOOKBACK || "24", 10),
    trend_period: parseInt(process.env.TREND_PERIOD || "200", 10),
    trend_threshold: parseFloat(process.env.TREND_THRESHOLD || "0.002"),
    stop_loss_pct: parseFloat(process.env.STOP_LOSS || "2.0"),
    martingale_factor: parseFloat(process.env.MARTINGALE || "3.0"),
    max_exposure_pct: parseFloat(process.env.MAX_EXPOSURE || "60"),
    max_drawdown_exit_pct: parseFloat(process.env.MAX_DD_EXIT || "10.0"),
  });

  const closes = candles.map((c) => c.close);
  for (let i = 0; i < candles.length - 1; i++) {
    const c = candles[i];
    bot.on_candle(
      c.timestamp,
      c.open,
      c.high,
      c.low,
      c.close,
      closes.slice(0, i + 1),
    );
  }

  bot.on_candle(
    lastCandle.timestamp,
    lastCandle.open,
    lastCandle.high,
    lastCandle.low,
    lastCandle.close,
    closes,
  );
  console.log(
    `Bot internal state: ${bot.positions.length} active positions, ${bot.open_orders.size} grid orders placed.`,
  );

  // Make an execution decision based on Indicators
  const lookback = bot["volatility_lookback"] || 20;
  if (closes.length > lookback) {
    const rsi = IndicatorService.computeRSI(closes, 14);
    const trend = IndicatorService.computeTrend(
      closes,
      bot["trend_period"],
      bot["trend_threshold"],
    );
    console.log(`Current RSI: ${rsi.toFixed(2)}, Trend: ${trend}`);

    // Simplistic decision taking for the cron job:
    // Buy if oversold and downtrend (grabbing value), Sell if overbought and uptrend (taking profit)
    // NOTE: Replace with real strategy output
    try {
      const recentTrades = bot.trade_log.filter(
        (t) => t.timestamp === lastCandle.timestamp,
      );

      if (recentTrades.length > 0) {
        for (const trade of recentTrades) {
          const side = trade.side.toUpperCase() as "BUY" | "SELL";
          const quoteQty = trade.price * trade.quantity;

          console.log(
            `-> Strategy output: ${side} at ${trade.price}. Reason: ${trade.reason || "grid fill"}`,
          );
          await executor.openMarketOrder(
            symbolNormalized,
            side,
            quoteQty,
            false, // testOnly flag
          );
          console.log(
            `-> Live ${side} execution completed for ~${quoteQty.toFixed(2)} USDT.`,
          );
        }
      } else {
        console.log(
          "-> Strategy output: Holding current positions. No new execution necessary.",
        );
      }
    } catch (err) {
      console.error("-> Execution failed:", err);
    }
  } else {
    console.log(
      "-> Not enough data to compute indicators and take a decision.",
    );
  }

  console.log(
    `[${new Date().toISOString()}] Bot cron execution finished successfully.`,
  );
}

if (require.main === module) {
  main().catch(console.error);
}
