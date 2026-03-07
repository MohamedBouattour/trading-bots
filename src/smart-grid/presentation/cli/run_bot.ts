import * as dotenv from "dotenv";
import * as path from "path";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";

// ─── Bootstrap: suppress Node.js deprecation warnings & dotenv noise ─────────

const _originalEmitWarning = process.emitWarning;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(process as any).emitWarning = (warning: string | Error, ...args: unknown[]) => {
  if (args[0] === "DeprecationWarning") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (_originalEmitWarning as any)(warning, ...args);
};

const _originalLog = console.log;
const _originalInfo = console.info;
console.log = () => {};
console.info = () => {};
dotenv.config({ path: path.join(process.cwd(), ".env") });
console.log = _originalLog;
console.info = _originalInfo;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BinanceOrder {
  orderId: number;
  side: "BUY" | "SELL";
  price: string;
  origQty: string;
}

interface Config {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  gridCount: number;
  swingPct: number;
  takeProfitPct: number;
}

interface MarketState {
  currentPrice: number;
  freeBase: number;
  freeQuote: number;
  openBuys: BinanceOrder[];
  openSells: BinanceOrder[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRICE_TOLERANCE = 0.001; // 0.1% — acceptable grid drift before re-placing
const MIN_ORDER_NOTIONAL = 5.5; // USDT — Binance minimum order notional value

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig(): Config {
  const symbol = (process.env.ASSET ?? "BTCUSDT").replace(/['"/]/g, "");
  const quoteAsset = symbol.endsWith("USDT") ? "USDT" : symbol.slice(-4);
  const baseAsset = symbol.replace(quoteAsset, "");

  return {
    apiKey: process.env.API_KEY ?? "",
    apiSecret: process.env.SECRET_KEY ?? "",
    symbol,
    baseAsset,
    quoteAsset,
    gridCount: parseInt(process.env.GRID_COUNT ?? "15", 10),
    swingPct: parseFloat(process.env.SWING_PCT ?? "15"),
    takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT ?? "1"),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function priceMatches(a: number, b: number): boolean {
  return Math.abs(a - b) / b < PRICE_TOLERANCE;
}

// ─── Market State ─────────────────────────────────────────────────────────────

async function fetchMarketState(
  executor: BinanceOrderExecutionService,
  marketData: BinanceMarketDataProvider,
  config: Config,
): Promise<MarketState | null> {
  const [candles, balances, rawOrders] = await Promise.all([
    marketData.getHistoricalData(config.symbol, "1h", 2),
    executor.getAccountBalances(),
    executor.getOpenOrders(config.symbol),
  ]);

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    log("ERROR: No candle data returned. Aborting.");
    return null;
  }

  const openOrders = rawOrders as BinanceOrder[];
  const baseBalance = balances.find((b) => b.asset === config.baseAsset);
  const quoteBalance = balances.find((b) => b.asset === config.quoteAsset);

  return {
    currentPrice: lastCandle.close,
    freeBase: parseFloat(baseBalance?.free ?? "0"),
    freeQuote: parseFloat(quoteBalance?.free ?? "0"),
    openBuys: openOrders.filter((o) => o.side === "BUY"),
    openSells: openOrders.filter((o) => o.side === "SELL"),
  };
}

// ─── Phase 1: Sell Unhedged Asset ─────────────────────────────────────────────
//
// Detects free (unhedged) base asset — asset held but not yet covered by an
// open SELL order — and places a single limit sell at +takeProfitPct above
// the current price.
//
// Why use currentPrice as the entry estimate?
//   Grid buys fill at or below currentPrice by definition (they sit below spot).
//   Selling at currentPrice * 1.01 guarantees >= 1% ROI from the actual fill
//   price, making this a safe stateless approximation.

async function syncSellOrders(
  executor: BinanceOrderExecutionService,
  config: Config,
  state: MarketState,
): Promise<void> {
  const { currentPrice, freeBase, openSells } = state;
  const notional = freeBase * currentPrice;

  if (notional < MIN_ORDER_NOTIONAL) {
    log(
      `[SELL] Nothing to sell —` +
        ` ${freeBase.toFixed(6)} ${config.baseAsset}` +
        ` ≈ ${notional.toFixed(2)} ${config.quoteAsset} (below min notional)`,
    );
    return;
  }

  const targetPrice = currentPrice * (1 + config.takeProfitPct / 100);

  const alreadyExists = openSells.some((o) =>
    priceMatches(parseFloat(o.price), targetPrice),
  );

  if (alreadyExists) {
    log(`[SELL] Sell order @ ~${targetPrice.toFixed(2)} already in place. Skipping.`);
    return;
  }

  log(
    `[SELL] Placing LIMIT SELL` +
      ` ${freeBase.toFixed(6)} ${config.baseAsset}` +
      ` @ ${targetPrice.toFixed(2)} ${config.quoteAsset}` +
      ` (+${config.takeProfitPct}% TP)`,
  );

  await executor.placeLimitOrder(config.symbol, "SELL", targetPrice, freeBase);
}

// ─── Phase 2: Buy Grid ────────────────────────────────────────────────────────
//
// Builds a ladder of `gridCount` limit buy orders spread evenly from
// -stepPct% down to -swingPct% below current price.
// Per-order budget = Math.trunc(freeQuote / gridCount).
// Stale orders (outside the new grid) are cancelled before placing new ones.

async function syncBuyOrders(
  executor: BinanceOrderExecutionService,
  config: Config,
  state: MarketState,
): Promise<void> {
  const { currentPrice, freeQuote, openBuys } = state;
  const perOrderBudget = Math.trunc(freeQuote / config.gridCount);

  if (perOrderBudget < MIN_ORDER_NOTIONAL) {
    log(
      `[BUY] Insufficient ${config.quoteAsset} to build grid` +
        ` (${freeQuote.toFixed(2)} / ${config.gridCount} = ${perOrderBudget} per order)`,
    );
    return;
  }

  // stepPct = swingPct / gridCount → e.g. 15% / 15 = 1% per level
  const stepPct = config.swingPct / config.gridCount;

  const targetLevels = Array.from({ length: config.gridCount }, (_, i) => {
    const levelPrice = currentPrice * (1 - ((i + 1) * stepPct) / 100);
    const quantity = perOrderBudget / levelPrice;
    return { price: levelPrice, quantity };
  });

  // Cancel stale buy orders no longer in the grid
  for (const order of openBuys) {
    const orderPrice = parseFloat(order.price);
    const isInGrid = targetLevels.some((t) => priceMatches(t.price, orderPrice));
    if (!isInGrid) {
      log(`[BUY] Cancelling stale order @ ${orderPrice}`);
      await executor.cancelOrder(config.symbol, order.orderId);
    }
  }

  // Place missing levels
  let placed = 0;
  let kept = 0;

  for (const target of targetLevels) {
    const exists = openBuys.some((o) =>
      priceMatches(parseFloat(o.price), target.price),
    );
    if (exists) {
      kept++;
      continue;
    }

    await executor.placeLimitOrder(
      config.symbol,
      "BUY",
      target.price,
      target.quantity,
    );
    placed++;
  }

  log(
    `[BUY] Grid sync: ${placed} placed, ${kept} kept.` +
      ` Budget: ${perOrderBudget} ${config.quoteAsset}/order` +
      ` @ ${stepPct}% steps → ${config.gridCount} levels covering ${config.swingPct}% swing`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.apiKey || !config.apiSecret) {
    console.warn("[WARN] API credentials missing — execution may fail.");
  }

  const executor = new BinanceOrderExecutionService(
    config.apiKey || "dummy",
    config.apiSecret || "dummy",
  );
  const marketData = new BinanceMarketDataProvider();

  log(`Grid Bot starting for ${config.symbol}...`);

  const state = await fetchMarketState(executor, marketData, config);
  if (!state) return;

  log(
    `State — Price: ${state.currentPrice}` +
      ` | Free ${config.baseAsset}: ${state.freeBase.toFixed(6)}` +
      ` | Free ${config.quoteAsset}: ${state.freeQuote.toFixed(2)}` +
      ` | Open BUY: ${state.openBuys.length}, SELL: ${state.openSells.length}`,
  );

  await syncSellOrders(executor, config, state);
  await syncBuyOrders(executor, config, state);

  log("Cron execution completed.");
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch(console.error);
}
