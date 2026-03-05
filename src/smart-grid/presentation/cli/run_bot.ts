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
const symbolNormalized = symbol.replace(/['"\/]/g, "");
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

  // Derive asset / quote names from the symbol (e.g. ETHUSDT → ETH / USDT)
  const quoteAsset = symbolNormalized.endsWith("USDT")
    ? "USDT"
    : symbolNormalized.substring(symbolNormalized.length - 4);
  const asset = symbolNormalized.replace(quoteAsset, "");

  // ─── 1. Fetch candles AND real balances concurrently ──────────────────────
  console.log(`Fetching latest 100 hourly candles for ${symbolNormalized}...`);

  const [candles, initialBalances] = await Promise.all([
    marketData.getHistoricalData(symbolNormalized, "1h", 100, 1),
    executor
      .getAccountBalances()
      .catch(
        (): { asset: string; free: string; locked: string }[] => [],
      ),
  ]);

  if (candles.length === 0) {
    console.log("No candles retrieved. Exiting execution.");
    return;
  }

  const lastCandle = candles[candles.length - 1];
  console.log(
    `Latest candle: Close=${lastCandle.close}, High=${lastCandle.high}, Low=${lastCandle.low}`,
  );

  // ─── 2. Compute REAL portfolio capital from exchange balances ─────────────
  //
  // Capital = free + locked quote  +  (free + locked base-asset) * current price
  // This is the single source of truth for grid sizing — NOT the .env BALANCE.
  const assetBalObj = initialBalances.find((b) => b.asset === asset);
  const quoteBalObj = initialBalances.find((b) => b.asset === quoteAsset);

  const freeAsset = assetBalObj ? parseFloat(assetBalObj.free) : 0;
  const lockedAsset = assetBalObj ? parseFloat(assetBalObj.locked) : 0;
  const freeQuote = quoteBalObj ? parseFloat(quoteBalObj.free) : 0;
  const lockedQuote = quoteBalObj ? parseFloat(quoteBalObj.locked) : 0;

  const currentPrice = lastCandle.close;
  const realTotalCapital =
    freeQuote + lockedQuote + (freeAsset + lockedAsset) * currentPrice;

  // Fall back to env BALANCE when running in paper / test mode (no real balances)
  const effectiveCapital = realTotalCapital > 0 ? realTotalCapital : balanceToUse;

  console.log(
    `[Capital] ${freeQuote.toFixed(2)} ${quoteAsset} free + ${lockedQuote.toFixed(2)} locked` +
      ` | ${freeAsset.toFixed(6)} ${asset} free + ${lockedAsset.toFixed(6)} locked` +
      ` → effectiveCapital = ${effectiveCapital.toFixed(2)} ${quoteAsset}`,
  );

  // ─── 3. Scan current positions ────────────────────────────────────────────
  console.log(
    `Scanning current positions... (this would be queried from API in production)`,
  );

  // ─── 4. Instantiate bot with REAL capital ────────────────────────────────
  //
  // Passing effectiveCapital ensures _rebuild_grid sizes qty_per_order correctly
  // for what we actually own — not the stale .env BALANCE value.
  const bot = new SmartGridBot({
    symbol: symbolNormalized,
    initial_balance: effectiveCapital,
    grid_density: parseFloat(process.env.GRID_DENSITY || "100"),
    take_profit_pct: parseFloat(process.env.TAKE_PROFIT || "0.8"),
    qty_per_order: parseFloat(process.env.QTY_PER_ORDER || "0.0"),
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

  // ─── 5. Reconcile manual buys ─────────────────────────────────────────────
  //
  // If real asset qty > simulated qty (e.g. manual buy), inject a tracked position.
  const totalActualQty = freeAsset + lockedAsset;
  const botSimulatedQty = bot.positions.reduce((sum, p) => sum + p.quantity, 0);
  const diffQty = totalActualQty - botSimulatedQty;

  if (diffQty > 0.001) {
    console.log(
      `[Reconciliation] Found ${diffQty.toFixed(4)} ${asset} not tracked by bot (Manual buy detected).`,
    );
    console.log(
      `[Reconciliation] Injecting manual position into bot management...`,
    );

    const entryPrice = currentPrice;
    const tpPrice = entryPrice * (1 + bot.take_profit_pct / 100);
    const slPrice =
      bot.stop_loss_pct > 0 ? entryPrice * (1 - bot.stop_loss_pct / 100) : 0;

    bot.positions.push(
      new Position(entryPrice, diffQty, tpPrice, slPrice, bot.trailing_stop_pct),
    );

    console.log(
      `[Reconciliation] Bot now managing total ${totalActualQty.toFixed(4)} ${asset}.`,
    );
  }

  // ─── 6. Synchronize Limit Orders with Binance ─────────────────────────────
  console.log("\n[Sync] Synchronizing Limit Orders with Binance...");
  try {
    const openOrders = await executor.getOpenOrders(symbolNormalized);
    const buyOrders = openOrders.filter(
      (o: { side: "BUY" | "SELL" }) => o.side === "BUY",
    );
    const sellOrders = openOrders.filter(
      (o: { side: "BUY" | "SELL" }) => o.side === "SELL",
    );

    // ── BUY GRID ──────────────────────────────────────────────────────────
    const targetBuys = Array.from(bot.open_orders.values());

    // Cancel stale buy orders that are no longer in the bot's grid
    for (const ob of buyOrders) {
      const price = parseFloat((ob as { price: string }).price);
      const matches = targetBuys.some(
        (tb) => Math.abs(tb.price - price) / price < 0.0001,
      );
      if (!matches) {
        await executor.cancelOrder(symbolNormalized, (ob as { orderId: number }).orderId);
      }
    }

    // Refresh balances after cancellations — freed USDT is now available again
    const freshBalances = await executor.getAccountBalances();
    const freshQuoteObj = freshBalances.find(
      (b: { asset: string; free: string }) => b.asset === quoteAsset,
    );
    const freshAssetObj = freshBalances.find(
      (b: { asset: string; free: string }) => b.asset === asset,
    );

    let availableQuote = freshQuoteObj ? parseFloat(freshQuoteObj.free) : freeQuote;
    // Track free (non-locked) asset for sell guard — locked asset is already in open sell orders
    let availableFreeAsset = freshAssetObj ? parseFloat(freshAssetObj.free) : freeAsset;

    console.log(
      `[Sync] Available ${quoteAsset}: ${availableQuote.toFixed(2)} | Available ${asset}: ${availableFreeAsset.toFixed(6)}`,
    );

    // Place missing buy orders — skip if actual wallet can't cover the cost
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
            false,
          );
          availableQuote -= cost;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Sync] Failed to place BUY @ ${tb.price}:`, errorMsg);
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            (err as { code: number }).code === -2010
          ) {
            console.warn(
              `[Sync] Insufficient balance returned from exchange. Stopping BUY grid placement.`,
            );
            break;
          }
        }
      }
    }

    // ── SELL GRID (Take Profits) ──────────────────────────────────────────
    const targetSells = bot.positions.map((p) => ({
      price: p.take_profit_price,
      quantity: p.quantity,
    }));

    // Cancel sell orders no longer needed
    for (const os of sellOrders) {
      const price = parseFloat((os as { price: string }).price);
      const matches = targetSells.some(
        (ts) => Math.abs(ts.price - price) / price < 0.0001,
      );
      if (!matches) {
        await executor.cancelOrder(symbolNormalized, (os as { orderId: number }).orderId);
      }
    }

    // Place missing sell orders — only sell what we actually own
    for (const ts of targetSells) {
      const alreadyPlaced = sellOrders.some(
        (os: { price: string }) =>
          Math.abs(parseFloat(os.price) - ts.price) / ts.price < 0.0001,
      );
      if (!alreadyPlaced) {
        // KEY FIX: guard against placing a SELL when we don't hold the asset
        if (availableFreeAsset < ts.quantity - 0.000001) {
          console.warn(
            `[Sync] Insufficient ${asset} to place SELL at ${ts.price} (Requires ${ts.quantity.toFixed(6)}, but only ${availableFreeAsset.toFixed(6)} free). Skipping.`,
          );
          continue;
        }

        try {
          await executor.placeLimitOrder(
            symbolNormalized,
            "SELL",
            ts.price,
            ts.quantity,
            false,
          );
          availableFreeAsset -= ts.quantity; // track remaining sellable balance
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Sync] Failed to place SELL @ ${ts.price}:`, errorMsg);
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            (err as { code: number }).code === -2010
          ) {
            console.warn(
              `[Sync] Insufficient asset balance returned from exchange. Stopping SELL grid placement.`,
            );
            break;
          }
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
