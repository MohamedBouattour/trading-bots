import { IPortfolioDataProvider } from "../ports/IPortfolioDataProvider";
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
     * @param forceCheck  If true, skip the interval check and run immediately.
     * @returns The RebalanceResult, or null if skipped (e.g. too soon since last check).
     */
    async execute(forceCheck = false): Promise<RebalanceResult | null> {
        // ── 1. Load or initialize state ───────────────────────────────────
        const state = await this.stateStore.load();
        const isFirstRun = state === null;

        if (isFirstRun) {
            this.logger.info(
                "No existing state found. Initializing fresh state...",
            );
        }

        // ── 2. Fetch portfolio data with retry ─────────────────────────────
        const snapshot = await this.fetchSnapshotWithRetry();
        if (!snapshot) {
            this.logger.error(
                "Failed to fetch portfolio data after retries. Skipping this cycle.",
            );
            return null;
        }

        // ── 3. Log portfolio dashboard ─────────────────────────────────────
        this.logPortfolioDashboard(snapshot, state);

        // ── 4. Run rebalancing engine ──────────────────────────────────────
        const result = this.engine.analyzePortfolio(snapshot, this.config);
        this.logger.info(result.summary);

        // ── 5. Interval check (only block TRADES, keep the dashboard) ──────
        let canTrade = true;
        if (!forceCheck && state && state.lastCheckTimestamp) {
            const elapsed = Date.now() - state.lastCheckTimestamp;
            const intervalMs = this.config.rebalanceIntervalSeconds * 1000;
            if (elapsed < intervalMs) {
                const remaining = intervalMs - elapsed;
                const hoursLeft = (remaining / 3_600_000).toFixed(1);
                this.logger.info(
                    `[COOLDOWN ACTIVE] Trade execution blocked. Next rebalance window in ${hoursLeft}h`,
                );
                canTrade = false;
            }
        }

        // ── 6. Execute trades if needed ────────────────────────────────────
        const tradeResults: TradeResult[] = [];
        if (canTrade && result.actions.length > 0) {
            if (this.config.dryRun) {
                this.logger.warn("DRY RUN MODE — trades will NOT be executed");
                for (const action of result.actions) {
                    this.logger.trade(
                        `[DRY RUN] ${action.side} $${action.amountUSDT.toFixed(2)} of ${action.symbol} ` +
                        `(${action.quantityAsset.toFixed(6)} units) — reason: ${action.reason}`,
                    );
                }
            } else {
                // Execute SELL orders first, then BUY orders
                const sellActions = result.actions.filter((a) => a.side === "SELL");
                const buyActions = result.actions.filter((a) => a.side === "BUY");

                for (const action of [...sellActions, ...buyActions]) {
                    try {
                        this.logger.trade(
                            `Executing ${action.side} $${action.amountUSDT.toFixed(2)} of ${action.symbol} — ${action.reason}`,
                        );
                        const tradeResult = await this.tradeExecutor.executeMarketOrder(
                            action.symbol,
                            action.side,
                            action.amountUSDT,
                        );
                        tradeResults.push(tradeResult);
                        this.logger.trade(
                            `✅ ${tradeResult.status}: ${tradeResult.side} ${tradeResult.executedQty} ${action.symbol} @ $${tradeResult.executedPrice.toFixed(2)}`,
                        );
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.logger.error(
                            `Failed to execute ${action.side} for ${action.symbol}`,
                            error,
                        );
                    }
                }
            }
        }

        // ── 7. Update and save state ───────────────────────────────────────
        const now = Date.now();
        const updatedState: BotState = state
            ? { ...state }
            : createInitialBotState(snapshot.totalValueUSDT);

        // Only update the cooldown timer if we actually reached the interval!
        if (canTrade) {
            updatedState.lastCheckTimestamp = now;
        }
        updatedState.lastSnapshot = snapshot;

        if (result.actions.length > 0 && !this.config.dryRun) {
            updatedState.lastRebalanceTimestamp = now;
            updatedState.totalRebalanceCount += 1;
            updatedState.cumulativeFeesPaid += result.totalFeesEstimated;
        }

        // Append to history (cap at 12 entries)
        updatedState.rebalanceHistory.push(result);
        if (updatedState.rebalanceHistory.length > 12) {
            updatedState.rebalanceHistory =
                updatedState.rebalanceHistory.slice(-12);
        }

        await this.stateStore.save(updatedState);
        this.logger.info("State saved successfully.");

        // ── 8. Log next check time ─────────────────────────────────────────
        const nextCheckDate = new Date(
            now + this.config.rebalanceIntervalSeconds * 1000,
        );
        this.logger.info(`Next check scheduled: ${nextCheckDate.toISOString()}`);

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

            allocations.push({
                symbol: assetConfig.symbol,
                targetWeight: assetConfig.targetWeight,
                currentWeight: 0, // Calculated below
                currentValueUSDT: value,
                targetValueUSDT: 0, // Calculated below
                positionQty: qty,
                currentPrice: price,
                driftPct: 0, // Calculated below
            });
        }

        // Multiply freeUSDT by leverage to get the Notional Purchasing Power of the cash
        const effectiveFreeUSDT = freeUSDT * this.config.leverage;
        const totalValueUSDT = totalPositionValue + effectiveFreeUSDT;

        // Calculate weights, target values, and drift
        for (const alloc of allocations) {
            alloc.currentWeight =
                totalValueUSDT > 0 ? alloc.currentValueUSDT / totalValueUSDT : 0;
            alloc.targetValueUSDT = totalValueUSDT * alloc.targetWeight;
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
        const separator =
            "═══════════════════════════════════════════════════════════════";
        const divider =
            "───────────────────────────────────────────────────────────────";

        const checkNum = state ? state.totalRebalanceCount + 1 : 1;
        this.logger.info(separator);
        this.logger.info(`📊 REBALANCER CHECK #${checkNum}`);
        this.logger.info(separator);

        // Calculate ROI
        const initialValue = state?.initialPortfolioValueUSDT ||
            this.config.totalBalanceUSDT;
        const roi =
            initialValue > 0
                ? ((snapshot.totalValueUSDT - initialValue) / initialValue) * 100
                : 0;
        const roiSign = roi >= 0 ? "+" : "";

        this.logger.info(
            `💰 Portfolio Value: $${snapshot.totalValueUSDT.toFixed(2)} (${roiSign}${roi.toFixed(2)}% ROI)`,
        );

        for (let i = 0; i < snapshot.allocations.length; i++) {
            const a = snapshot.allocations[i];
            const isLast = i === snapshot.allocations.length - 1;
            const prefix = isLast ? "   └─" : "   ├─";
            const driftSign = a.driftPct >= 0 ? "+" : "";
            this.logger.info(
                `${prefix} ${a.symbol.padEnd(10)} $${a.currentValueUSDT.toFixed(2).padStart(10)} ` +
                `(${(a.currentWeight * 100).toFixed(1)}%) ` +
                `[target: ${(a.targetWeight * 100).toFixed(1)}%] ` +
                `drift: ${driftSign}${a.driftPct.toFixed(1)}%`,
            );
        }

        this.logger.info(
            `   └─ Free USDT: $${snapshot.freeUSDT.toFixed(2)}`,
        );
        this.logger.info(divider);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
