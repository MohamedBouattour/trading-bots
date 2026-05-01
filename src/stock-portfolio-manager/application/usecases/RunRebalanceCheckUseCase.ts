import { IPortfolioDataProvider, PositionInfo } from "../ports/IPortfolioDataProvider";
import { ITradeExecutor, TradeResult } from "../ports/ITradeExecutor";
import {
    IStateStore,
    BotState,
    createInitialBotState,
} from "../ports/IStateStore";
import { ILogger } from "../ports/ILogger";
import { PortfolioConfig } from "../../domain/models/PortfolioConfig";
import { PortfolioSnapshot } from "../../domain/models/PortfolioSnapshot";
import { AssetAllocation } from "../../domain/models/AssetAllocation";
import { RebalanceResult } from "../../domain/models/RebalanceResult";
import { RebalancingEngine } from "../../domain/services/RebalancingEngine";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]; // Exponential backoff

export class RunRebalanceCheckUseCase {
    /** Cached position data for dashboard enrichment */
    private _lastPositions: PositionInfo[] = [];

    constructor(
        private readonly dataProvider: IPortfolioDataProvider,
        private readonly tradeExecutor: ITradeExecutor,
        private readonly stateStore: IStateStore,
        private readonly logger: ILogger,
        private readonly config: PortfolioConfig,
        private readonly engine: RebalancingEngine,
    ) { }

    /**
     * Execute a single rebalance-check cycle.
     *
     * @returns The RebalanceResult, or null if skipped.
     */
    async execute(): Promise<RebalanceResult | null> {
        const cycleStart = Date.now();

        // ── 1. Load or initialize state ───────────────────────────────────
        const state = await this.stateStore.load();
        const isFirstRun = state === null;

        if (isFirstRun) {
            this.logger.warn(
                "No existing state found. Initializing fresh state...",
            );
        }

        // ── 2. Fetch portfolio data with retry ─────────────────────────────
        this.logger.debug("Fetching portfolio data from Binance...");
        const snapshot = await this.fetchSnapshotWithRetry();
        if (!snapshot) {
            this.logger.error(
                "Failed to fetch portfolio data after retries. Skipping this cycle.",
            );
            return null;
        }
        this.logger.debug(`Snapshot fetched in ${Date.now() - cycleStart}ms`);

        // ── 3. Log portfolio dashboard ─────────────────────────────────────
        this.logPortfolioDashboard(snapshot, state);

        // ── 4. Run rebalancing engine ──────────────────────────────────────
        const initialValueUSDT =
            state?.initialPortfolioValueUSDT ??
            this.config.totalBalanceUSDT;
        const result = this.engine.analyzePortfolio(
            snapshot,
            this.config,
            initialValueUSDT,
        );
        this.logger.info(result.summary);

        // Log auto-scale and compound details
        if (result.autoScaleApplied) {
            this.logger.info(
                `🔄 AUTO-SCALE: Portfolio value ($${snapshot.totalValueUSDT.toFixed(2)}) exceeds config ($${this.config.totalBalanceUSDT.toFixed(2)}). Targets recalculated.`,
            );
        }
        if (result.portfolioRoiHarvestTriggered) {
            const roiActions = result.actions.filter((a) => a.reason === "ROI_HARVEST");
            const totalSold = roiActions.reduce((s, a) => s + a.amountUSDT, 0);
            const activePositions = snapshot.allocations.reduce((s, a) => s + a.currentValueUSDT, 0);
            const roi = ((activePositions - initialValueUSDT) / initialValueUSDT) * 100;
            this.logger.info(
                `💰 ROI HARVEST: Portfolio at +${roi.toFixed(1)}% ROI (threshold: +${this.config.portfolioRoiHarvestPct ?? 0}%). Selling 20% of each position — $${totalSold.toFixed(2)} total.`,
            );
        }
        if (result.compoundTriggered) {
            const compoundActions = result.actions.filter((a) => a.reason === "COMPOUND_INVEST");
            const totalCompound = compoundActions.reduce((s, a) => s + a.amountUSDT, 0);
            this.logger.info(
                `📈 COMPOUND: Deploying $${totalCompound.toFixed(2)} notional from $${snapshot.freeUSDT.toFixed(2)} free margin into ${compoundActions.length} asset(s).`,
            );
        }

        // ── 5. Setup execution context ──────────────────────────────────────
        const canTrade = true;

        // ── 6. Execute trades if needed ────────────────────────────────────
        const tradeResults: TradeResult[] = [];
        if (canTrade && result.actions.length > 0) {
            if (this.config.dryRun) {
                this.logger.warn("DRY RUN MODE — trades will NOT be executed");
                for (const action of result.actions) {
                    this.logger.trade(
                        `[DRY] ${action.side} $${action.amountUSDT.toFixed(2)} of ${action.symbol} ` +
                        `(${action.quantityAsset.toFixed(6)} units) — ${action.reason} ` +
                        `[${(action.fromWeight * 100).toFixed(1)}% → ${(action.toWeight * 100).toFixed(1)}%]`,
                    );
                }
            } else {
                // Execute SELL orders first, then BUY orders
                const sellActions = result.actions.filter((a) => a.side === "SELL");
                const buyActions = result.actions.filter((a) => a.side === "BUY");
                const orderedActions = [...sellActions, ...buyActions];

                this.logger.info(
                    `Executing ${orderedActions.length} trade(s): ${sellActions.length} SELL → ${buyActions.length} BUY`,
                );

                for (let i = 0; i < orderedActions.length; i++) {
                    const action = orderedActions[i];
                    const orderNum = `[${i + 1}/${orderedActions.length}]`;
                    const tradeStart = Date.now();

                    try {
                        this.logger.trade(
                            `${orderNum} ${action.side} $${action.amountUSDT.toFixed(2)} ${action.symbol} — ${action.reason}`,
                        );
                        const tradeResult = await this.tradeExecutor.executeMarketOrder(
                            action.symbol,
                            action.side,
                            action.amountUSDT,
                        );
                        tradeResults.push(tradeResult);
                        const tradeElapsed = Date.now() - tradeStart;
                        this.logger.success(
                            `${orderNum} ${tradeResult.status}: ${tradeResult.side} ${tradeResult.executedQty} ${action.symbol} ` +
                            `@ $${tradeResult.executedPrice.toFixed(2)} (${tradeElapsed}ms)`,
                        );
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.logger.error(
                            `${orderNum} FAILED: ${action.side} ${action.symbol} — $${action.amountUSDT.toFixed(2)}`,
                            error,
                        );
                    }
                }

                // Trade execution summary
                const totalTraded = tradeResults.reduce(
                    (s, r) => s + r.executedQty * r.executedPrice, 0,
                );
                const totalFees = tradeResults.reduce((s, r) => s + r.commission, 0);
                this.logger.success(
                    `All trades done: ${tradeResults.length}/${orderedActions.length} filled | ` +
                    `Volume: $${totalTraded.toFixed(2)} | Est. fees: $${totalFees.toFixed(4)}`,
                );
            }
        } else if (canTrade && result.actions.length === 0) {
            this.logger.success("Portfolio is balanced — no trades needed.");
        }

        // ── 7. Update and save state ───────────────────────────────────────
        const now = Date.now();
        const updatedState: BotState = state
            ? { ...state }
            : createInitialBotState(snapshot.totalValueUSDT);

        // Only update the cooldown timer if we actually reached the interval!
        updatedState.lastCheckTimestamp = now;
        updatedState.lastSnapshot = snapshot;

        if (result.actions.length > 0 && !this.config.dryRun) {
            updatedState.lastRebalanceTimestamp = now;
            updatedState.totalRebalanceCount += 1;
            updatedState.cumulativeFeesPaid += result.totalFeesEstimated;
        }

        // Persist auto-scaled balance as the new high-water mark
        if (result.autoScaleApplied && snapshot.totalValueUSDT > updatedState.initialPortfolioValueUSDT) {
            this.logger.info(
                `📊 Portfolio grew from initial $${updatedState.initialPortfolioValueUSDT.toFixed(2)} to $${snapshot.totalValueUSDT.toFixed(2)} (auto-scale active).`,
            );
            updatedState.initialPortfolioValueUSDT = snapshot.totalValueUSDT;
        }

        // Append to history (cap at 12 entries)
        updatedState.rebalanceHistory.push(result);
        if (updatedState.rebalanceHistory.length > 12) {
            updatedState.rebalanceHistory =
                updatedState.rebalanceHistory.slice(-12);
        }

        await this.stateStore.save(updatedState);
        this.logger.debug("State saved successfully.");

        // ── 8. Cycle footer ─────────────────────────────────────────────────
        const cycleDuration = Date.now() - cycleStart;
        this.logger.info(
            `───────────────────────────────────────────────────────────────`,
        );
        this.logger.info(
            `⏱️  Cycle completed in ${cycleDuration}ms`,
        );
        this.logger.info(
            `───────────────────────────────────────────────────────────────`,
        );

        return result;
    }

    /**
     * Build a PortfolioSnapshot from live exchange data.
     */
    private async buildSnapshot(): Promise<PortfolioSnapshot> {
        const symbols = this.config.assets.map((a) => a.symbol);

        // Fetch data in parallel
        const [prices, positions, freeUSDT] = await Promise.all([
            this.dataProvider.getCurrentPrices(symbols),
            this.dataProvider.getOpenPositions(),
            this.dataProvider.getAvailableBalance(),
        ]);

        // Store positions for dashboard enrichment
        this._lastPositions = positions;

        // Build allocation for each configured asset
        let totalPositionValue = 0;
        const allocations: AssetAllocation[] = [];

        for (const assetConfig of this.config.assets) {
            const price = prices.get(assetConfig.symbol) || 0;
            const position = positions.find(
                (p) => p.symbol === assetConfig.symbol,
            );
            const qty = position ? Math.abs(position.quantity) : 0;
            const value = qty * price;
            totalPositionValue += value;

            const pnl = position ? position.unrealizedPnl : 0;
            const entryValue = value - pnl;
            const unrealizedPnlPct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

            allocations.push({
                symbol: assetConfig.symbol,
                targetWeight: assetConfig.targetWeight,
                currentWeight: 0, // Calculated below
                currentValueUSDT: value,
                targetValueUSDT: 0, // Calculated below
                positionQty: qty,
                currentPrice: price,
                driftPct: 0, // Calculated below
                unrealizedPnlPct,
            });
        }

        // Multiply freeUSDT by leverage to get the Notional Purchasing Power of the cash
        const effectiveFreeUSDT = freeUSDT * this.config.leverage;
        const totalValueUSDT = totalPositionValue + effectiveFreeUSDT;

        // Calculate weights, target values, and drift based ONLY on active positions (Invested Capital)
        // This ensures harvested profits (free cash) are ignored and don't skew the asset drift
        for (const alloc of allocations) {
            alloc.currentWeight =
                totalPositionValue > 0 ? alloc.currentValueUSDT / totalPositionValue : 0;
            alloc.targetValueUSDT = totalPositionValue * alloc.targetWeight;
            alloc.driftPct =
                (alloc.currentWeight - alloc.targetWeight) * 100;
        }

        // Determine if balanced
        const isBalanced = allocations.every(
            (a) => Math.abs(a.driftPct) <= this.config.driftThresholdPct,
        );

        return {
            timestamp: Date.now(),
            totalValueUSDT,
            freeUSDT,
            allocations,
            isBalanced,
        };
    }

    /**
     * Fetch snapshot with exponential-backoff retry on failure.
     */
    private async fetchSnapshotWithRetry(): Promise<PortfolioSnapshot | null> {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await this.buildSnapshot();
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAYS_MS[attempt] || 5000;
                    this.logger.warn(
                        `Snapshot fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${delay / 1000}s...`,
                        { error: error.message },
                    );
                    await this.sleep(delay);
                } else {
                    this.logger.error(
                        `Snapshot fetch failed after ${MAX_RETRIES + 1} attempts.`,
                        error,
                    );
                }
            }
        }
        return null;
    }

    /**
     * Print a formatted portfolio dashboard to the logger.
     */
    private logPortfolioDashboard(
        snapshot: PortfolioSnapshot,
        state: BotState | null,
    ): void {
        const sep =
            "═══════════════════════════════════════════════════════════════";
        const div =
            "───────────────────────────────────────────────────────────────";

        const checkNum = state ? state.totalRebalanceCount + 1 : 1;
        this.logger.info(sep);
        this.logger.info(`📊 REBALANCER CHECK #${checkNum}`);
        this.logger.info(sep);

        // ── Portfolio value + ROI ───────────────────────────────────────
        const initialValue = state?.initialPortfolioValueUSDT ??
            this.config.totalBalanceUSDT;
        const roi =
            initialValue > 0
                ? ((snapshot.totalValueUSDT - initialValue) / initialValue) * 100
                : 0;
        const roiSign = roi >= 0 ? "+" : "";

        // Total unrealized PnL from positions
        const totalUnrealizedPnl = this._lastPositions.reduce(
            (sum, p) => sum + p.unrealizedPnl, 0,
        );
        const pnlSign = totalUnrealizedPnl >= 0 ? "+" : "";

        this.logger.info(
            `💰 Portfolio Value: $${snapshot.totalValueUSDT.toFixed(2)} (${roiSign}${roi.toFixed(2)}% ROI) | ` +
            `Unrealized PnL: ${pnlSign}$${totalUnrealizedPnl.toFixed(2)}`,
        );

        // ── Per-asset table header ──────────────────────────────────────
        this.logger.info(div);
        this.logger.info(
            `   ${"SYMBOL".padEnd(10)} ${"NOTIONAL".padStart(10)}  ` +
            `${"WEIGHT".padStart(6)}  ${"TARGET".padStart(6)}  ` +
            `${"DRIFT".padStart(7)}  ` +
            `${"ENTRY".padStart(9)}  ${"MARK".padStart(9)}  ` +
            `${"PNL".padStart(10)}  QTY`,
        );
        this.logger.info(div);

        // ── Per-asset rows ──────────────────────────────────────────────
        for (let i = 0; i < snapshot.allocations.length; i++) {
            const a = snapshot.allocations[i];
            const isLast = i === snapshot.allocations.length - 1;
            const prefix = isLast ? "   └─" : "   ├─";

            // Find matching position for entry price & PnL
            const pos = this._lastPositions.find((p) => p.symbol === a.symbol);
            const entryPrice = pos ? `$${pos.entryPrice.toFixed(2)}` : "     —";
            const markPrice = a.currentPrice > 0 ? `$${a.currentPrice.toFixed(2)}` : "     —";
            const pnl = pos
                ? `${pos.unrealizedPnl >= 0 ? "+" : ""}$${pos.unrealizedPnl.toFixed(2)}`
                : "        —";
            const qty = a.positionQty > 0 ? a.positionQty.toFixed(4) : "—";

            // Drift indicator
            const driftSign = a.driftPct >= 0 ? "+" : "";
            const driftStr = `${driftSign}${a.driftPct.toFixed(1)}%`;

            // Drift bar visualization
            const driftBar = this.buildDriftBar(a.driftPct, this.config.driftThresholdPct);

            this.logger.info(
                `${prefix} ${a.symbol.padEnd(10)} $${a.currentValueUSDT.toFixed(2).padStart(9)}  ` +
                `${(a.currentWeight * 100).toFixed(1).padStart(5)}%  ` +
                `${(a.targetWeight * 100).toFixed(1).padStart(5)}%  ` +
                `${driftStr.padStart(7)}  ` +
                `${entryPrice.padStart(9)}  ${markPrice.padStart(9)}  ` +
                `${pnl.padStart(10)}  ${qty}  ${driftBar}`,
            );
        }

        // ── Free USDT + margin info ─────────────────────────────────────
        const notionalPower = snapshot.freeUSDT * this.config.leverage;
        const usedMargin = snapshot.totalValueUSDT - notionalPower;
        const marginRatio = snapshot.totalValueUSDT > 0
            ? (usedMargin / snapshot.totalValueUSDT * 100)
            : 0;

        this.logger.info(div);
        this.logger.info(
            `   💵 Free Margin: $${snapshot.freeUSDT.toFixed(2)} ` +
            `(${this.config.leverage}× → $${notionalPower.toFixed(2)} notional) | ` +
            `Margin Used: ${marginRatio.toFixed(1)}%`,
        );

        // ── Cumulative stats ────────────────────────────────────────────
        if (state) {
            this.logger.info(
                `   📈 Rebalances: ${state.totalRebalanceCount} | ` +
                `Fees Paid: $${state.cumulativeFeesPaid.toFixed(2)} | ` +
                `Last Rebalance: ${state.lastRebalanceTimestamp > 0
                    ? this.formatDate(new Date(state.lastRebalanceTimestamp))
                    : "never"
                }`,
            );
        }

        this.logger.info(div);
    }

    /**
     * Build a simple ASCII drift bar: ████░░░░ or ░░░░████
     */
    private buildDriftBar(driftPct: number, threshold: number): string {
        const maxBlocks = 8;
        const ratio = Math.min(Math.abs(driftPct) / threshold, 1);
        const filled = Math.round(ratio * maxBlocks);
        const empty = maxBlocks - filled;

        if (driftPct >= 0) {
            return "█".repeat(filled) + "░".repeat(empty);
        } else {
            return "░".repeat(empty) + "█".repeat(filled);
        }
    }

    /**
     * Format a date in a readable local format: "2026-04-15 19:46"
     */
    private formatDate(date: Date): string {
        const y = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const h = String(date.getHours()).padStart(2, "0");
        const mi = String(date.getMinutes()).padStart(2, "0");
        return `${y}-${mo}-${d} ${h}:${mi}`;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
