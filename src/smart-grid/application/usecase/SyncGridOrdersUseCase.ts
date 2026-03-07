import { GridConfig } from "../../domain/model/GridConfig";
import { MarketState } from "../../domain/model/MarketState";
import { AssetBalance } from "../../domain/model/Balance";
import { computeBuyGrid } from "../../domain/service/GridCalculator";
import { computeCapital } from "../../domain/service/CapitalCalculator";
import {
  IOrderExecutorPort,
  ExchangeOrder,
} from "../../domain/port/IOrderExecutorPort";
import { IMarketDataPort } from "../../domain/port/IMarketDataPort";
import { ILoggerPort } from "../../domain/port/ILoggerPort";

export interface SyncGridOrdersInput {
  readonly config: GridConfig;
  /** Reference capital used for ROI calculation (from .env BALANCE) */
  readonly initialCapital: number;
}

const PRICE_TOLERANCE = 0.001; // 0.1% — avoids spammy re-placement on small drifts
const MIN_ORDER_NOTIONAL = 5.5; // Binance minimum order value in USDT

export class SyncGridOrdersUseCase {
  constructor(
    private readonly executor: IOrderExecutorPort,
    private readonly market: IMarketDataPort,
    private readonly logger: ILoggerPort,
  ) {}

  async execute(input: SyncGridOrdersInput): Promise<void> {
    const { config, initialCapital } = input;

    // ── 1. Resolve asset names from symbol (e.g. SOLUSDT → SOL / USDT) ────
    const quoteAsset = config.symbol.endsWith("USDT")
      ? "USDT"
      : config.symbol.slice(-4);
    const baseAsset = config.symbol.replace(quoteAsset, "");

    // ── 2. Fetch all exchange state concurrently ─────────────────────────
    const [candles, balances, openOrders] = await Promise.all([
      this.market.getHistoricalData(config.symbol, "1h", 1),
      this.executor.getAccountBalances(),
      this.executor.getOpenOrders(config.symbol),
    ]);

    const latestCandle = candles[candles.length - 1];
    if (!latestCandle) {
      this.logger.warn("[Sync] No candle data returned — aborting.");
      return;
    }

    const currentPrice = latestCandle.close;

    const ZERO_BALANCE: AssetBalance = { asset: "", free: 0, locked: 0 };
    const baseBalance =
      balances.find((b) => b.asset === baseAsset) ??
      { ...ZERO_BALANCE, asset: baseAsset };
    const quoteBalance =
      balances.find((b) => b.asset === quoteAsset) ??
      { ...ZERO_BALANCE, asset: quoteAsset };

    const state: MarketState = {
      symbol: config.symbol,
      baseAsset,
      quoteAsset,
      currentPrice,
      baseBalance,
      quoteBalance,
    };

    // ── 3. Log portfolio snapshot ─────────────────────────────────────────
    const { effectiveCapital, roiPct, pnlQuote } = computeCapital(
      quoteBalance,
      baseBalance,
      currentPrice,
      initialCapital,
    );
    const sign = pnlQuote >= 0 ? "+" : "";
    const roiTag = `[ROI: ${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(2)}% | ${sign}${pnlQuote.toFixed(2)} ${quoteAsset} | Val: ${effectiveCapital.toFixed(2)} ${quoteAsset}]`;
    this.logger.info(
      `${roiTag} price=${currentPrice} | ` +
        `${quoteBalance.free.toFixed(2)} ${quoteAsset} free, ` +
        `${baseBalance.free.toFixed(6)} ${baseAsset} free`,
    );

    const buyOrders = openOrders.filter((o) => o.side === "BUY");
    const sellOrders = openOrders.filter((o) => o.side === "SELL");

    // ── 4. Phase 1: Hedge any untracked base asset with a limit sell ──────
    await this.syncSellOrders(state, sellOrders, config.takeProfitPct);

    // ── 5. Phase 2: Rebuild buy grid below current price ──────────────────
    await this.syncBuyOrders(state, buyOrders, config);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SELL: one limit sell for the total unhedged base asset quantity
  // ─────────────────────────────────────────────────────────────────────────
  private async syncSellOrders(
    state: MarketState,
    sellOrders: ExchangeOrder[],
    takeProfitPct: number,
  ): Promise<void> {
    const { symbol, baseAsset, quoteAsset, currentPrice, baseBalance } = state;

    const qtyLockedInSells = sellOrders.reduce((s, o) => s + o.origQty, 0);
    const totalBase = baseBalance.free + baseBalance.locked;
    const unhedgedQty = totalBase - qtyLockedInSells;

    if (unhedgedQty <= 0.000001) {
      this.logger.info(`[SELL] All ${baseAsset} is hedged. Nothing to do.`);
      return;
    }

    const targetSellPrice = currentPrice * (1 + takeProfitPct / 100);

    const alreadyExists = sellOrders.some(
      (o) =>
        Math.abs(o.price - targetSellPrice) / targetSellPrice < PRICE_TOLERANCE,
    );
    if (alreadyExists) {
      this.logger.info(
        `[SELL] Sell order already exists near ${targetSellPrice.toFixed(4)} ${quoteAsset}.`,
      );
      return;
    }

    if (unhedgedQty * targetSellPrice < MIN_ORDER_NOTIONAL) {
      this.logger.warn(
        `[SELL] Skipped: notional too small ` +
          `(${unhedgedQty.toFixed(6)} ${baseAsset} × ${targetSellPrice.toFixed(2)} < ${MIN_ORDER_NOTIONAL} ${quoteAsset}).`,
      );
      return;
    }

    this.logger.info(
      `[SELL] Placing LIMIT SELL ${unhedgedQty.toFixed(6)} ${baseAsset}` +
        ` @ ${targetSellPrice.toFixed(4)} ${quoteAsset} (TP: +${takeProfitPct}%)`,
    );
    await this.executor.placeLimitOrder(
      symbol,
      "SELL",
      targetSellPrice,
      unhedgedQty,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUY: maintain a 15-level grid covering swingPct% below current price
  // ─────────────────────────────────────────────────────────────────────────
  private async syncBuyOrders(
    state: MarketState,
    buyOrders: ExchangeOrder[],
    config: GridConfig,
  ): Promise<void> {
    const { symbol, quoteAsset, currentPrice, quoteBalance } = state;

    const perOrderBudget = Math.trunc(quoteBalance.free / config.gridCount);
    if (perOrderBudget < MIN_ORDER_NOTIONAL) {
      this.logger.warn(
        `[BUY] Insufficient ${quoteAsset}: budget per order = ${perOrderBudget.toFixed(2)} < min ${MIN_ORDER_NOTIONAL}.`,
      );
      return;
    }

    const targetLevels = computeBuyGrid(currentPrice, perOrderBudget, config);

    // Cancel stale buy orders that are no longer part of the new grid
    for (const ob of buyOrders) {
      const stillValid = targetLevels.some(
        (lvl) => Math.abs(lvl.price - ob.price) / ob.price < PRICE_TOLERANCE,
      );
      if (!stillValid) {
        this.logger.info(
          `[BUY] Cancelling stale order #${ob.orderId} @ ${ob.price.toFixed(4)}`,
        );
        await this.executor.cancelOrder(symbol, ob.orderId);
      }
    }

    // Place levels not yet on exchange
    let placed = 0;
    let kept = 0;

    for (const lvl of targetLevels) {
      const exists = buyOrders.some(
        (ob) => Math.abs(ob.price - lvl.price) / lvl.price < PRICE_TOLERANCE,
      );
      if (exists) {
        kept++;
        continue;
      }

      try {
        await this.executor.placeLimitOrder(
          symbol,
          "BUY",
          lvl.price,
          lvl.quantity,
        );
        placed++;
      } catch (err) {
        this.logger.error(
          `[BUY] Failed to place order @ ${lvl.price.toFixed(4)} — stopping grid placement.`,
          err,
        );
        break; // likely insufficient balance; stop placing further orders
      }
    }

    this.logger.info(`[BUY] Grid sync done: ${placed} placed, ${kept} kept.`);
  }
}
