import * as dotenv from "dotenv";
import * as path from "path";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";
import { SmartGridBot } from "../../domain/bot/SmartGridBot";
import { Position } from "../../../models/Position";

// Suppress Node.js deprecation warnings (e.g., punycode, url.parse) natively
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...args: unknown[]) {
  if (args[0] === "DeprecationWarning") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (originalEmitWarning as any)(warning, ...args);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Suppress dotenv promotional console logs
const originalLog = console.log;
const originalInfo = console.info;
console.log = () => {};
console.info = () => {};
// Load .env relative to the current working directory, which for cron is usually the project root
dotenv.config({ path: path.join(process.cwd(), ".env") });
console.log = originalLog;
console.info = originalInfo;

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
    trailing_stop_pct: parseFloat(process.env.TRAILING_STOP || "0.0"),
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

  // 4. Sync with reality: Handle manual buys or existing balances
  try {
    const balances = await executor.getAccountBalances();
    const asset = symbolNormalized.replace("USDT", "");
    const assetBalance = balances.find(
      (b: { asset: string; free: string; locked: string }) => b.asset === asset,
    );
    const totalActualQty = assetBalance
      ? parseFloat(assetBalance.free) + parseFloat(assetBalance.locked)
      : 0;

    const botSimulatedQty = bot.positions.reduce(
      (sum, p) => sum + p.quantity,
      0,
    );
    const diffQty = totalActualQty - botSimulatedQty;

    // If we have more actual volume than simulated (e.g., manual buy), inject a position
    // Use a small threshold to avoid precision dust (e.g., 0.0001 ETH)
    if (diffQty > 0.001) {
      console.log(
        `[Reconciliation] Found ${diffQty.toFixed(4)} ${asset} not tracked by bot (Manual buy detected).`,
      );
      console.log(
        `[Reconciliation] Injecting manual position into bot management...`,
      );

      // For manual buys, we use the current price as entry price for TP/SL calculation
      // unless we want to be more sophisticated, but this is a good default.
      const entryPrice = lastCandle.close;
      const tpPrice = entryPrice * (1 + bot.take_profit_pct / 100);
      const slPrice =
        bot.stop_loss_pct > 0 ? entryPrice * (1 - bot.stop_loss_pct / 100) : 0;

      const manualPos = new Position(
        entryPrice,
        diffQty,
        tpPrice,
        slPrice,
        bot.trailing_stop_pct,
      );
      bot.positions.push(manualPos);

      console.log(
        `[Reconciliation] Bot now managing total ${totalActualQty.toFixed(4)} ${asset}.`,
      );
    }
  } catch (err) {
    console.warn(
      "[Reconciliation] Could not sync with exchange balances:",
      err,
    );
  }

  // 5. Finalize Grid & Positions: Synchronize with Binance Limit Orders
  console.log("\n[Sync] Synchronizing Limit Orders with Binance...");
  try {
    const openOrders = await executor.getOpenOrders(symbolNormalized);
    const buyOrders = openOrders.filter(
      (o: { side: "BUY" | "SELL" }) => o.side === "BUY",
    );
    const sellOrders = openOrders.filter(
      (o: { side: "BUY" | "SELL" }) => o.side === "SELL",
    );

    // --- MANAGE BUY GRID ---
    // Target buys from bot's open_orders
    const targetBuys = Array.from(bot.open_orders.values());

    // Cancel Buy orders that are no longer in the bot's grid
    for (const ob of buyOrders) {
      const price = parseFloat(ob.price);
      // If no target buy is within 0.01% of this price, cancel it
      const matches = targetBuys.some(
        (tb) => Math.abs(tb.price - price) / price < 0.0001,
      );
      if (!matches) {
        await executor.cancelOrder(symbolNormalized, ob.orderId);
      }
    }

    // Get quote asset balance to avoid "insufficient balance" errors
    const quoteAsset = symbolNormalized.endsWith("USDT")
      ? "USDT"
      : symbolNormalized.substring(symbolNormalized.length - 4);
    const balances = await executor.getAccountBalances();
    const quoteBalanceObj = balances.find(
      (b: { asset: string; free: string }) => b.asset === quoteAsset,
    );
    let availableQuote = quoteBalanceObj ? parseFloat(quoteBalanceObj.free) : 0;

    // Place missing Buy orders
    for (const tb of targetBuys) {
      const alreadyPlaced = buyOrders.some(
        (ob: { price: string }) =>
          Math.abs(parseFloat(ob.price) - tb.price) / tb.price < 0.0001,
      );
      if (!alreadyPlaced) {
        const cost = tb.price * tb.quantity;
        if (availableQuote < cost) {
          console.warn(
            `[Sync] Insufficient balance to place BUY at ${tb.price} (Requires ${cost.toFixed(2)} ${quoteAsset}, but only ${availableQuote.toFixed(2)} ${quoteAsset} available). Skipping.`,
          );
          continue;
        }

        try {
          await executor.placeLimitOrder(
            symbolNormalized,
            "BUY",
            tb.price,
            tb.quantity,
            false, // Live mode
          );
          availableQuote -= cost;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Sync] Failed to place BUY @ ${tb.price}:`, errorMsg);
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            err.code === -2010
          ) {
            console.warn(
              `[Sync] Insufficient balance returned from exchange. Stopping BUY grid placement.`,
            );
            break;
          }
        }
      }
    }

    // --- MANAGE SELL GRID (Take Profits) ---
    // Target sells from bot's positions
    const targetSells = bot.positions.map((p) => ({
      price: p.take_profit_price,
      quantity: p.quantity,
    }));

    // Cancel Sell orders that are no longer needed
    for (const os of sellOrders) {
      const price = parseFloat(os.price);
      const matches = targetSells.some(
        (ts) => Math.abs(ts.price - price) / price < 0.0001,
      );
      if (!matches) {
        await executor.cancelOrder(symbolNormalized, os.orderId);
      }
    }

    // Place missing Sell orders
    for (const ts of targetSells) {
      const alreadyPlaced = sellOrders.some(
        (os: { price: string }) =>
          Math.abs(parseFloat(os.price) - ts.price) / ts.price < 0.0001,
      );
      if (!alreadyPlaced) {
        try {
          await executor.placeLimitOrder(
            symbolNormalized,
            "SELL",
            ts.price,
            ts.quantity,
            false, // Live mode
          );
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Sync] Failed to place SELL @ ${ts.price}:`, errorMsg);
        }
      }
    }

    console.log("[Sync] Limit order synchronization completed.");
  } catch (err) {
    console.error("[Sync] Failed to sync limit orders:", err);
  }

  console.log(
    `[${new Date().toISOString()}] Bot cron execution finished successfully.`,
  );
}

if (require.main === module) {
  main().catch(console.error);
}
