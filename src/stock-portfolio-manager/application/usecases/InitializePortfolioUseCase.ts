import {
    IPortfolioDataProvider,
} from "../ports/IPortfolioDataProvider";
import { ITradeExecutor, TradeResult } from "../ports/ITradeExecutor";
import {
    IStateStore,
    createInitialBotState,
} from "../ports/IStateStore";
import { ILogger } from "../ports/ILogger";
import { PortfolioConfig } from "../../domain/models/PortfolioConfig";

/**
 * First-time portfolio setup use case.
 * Buys into all configured assets according to their target weight allocation.
 *
 * Safety: refuses to run if state already exists (preventing double-initialization).
 */
export class InitializePortfolioUseCase {
    constructor(
        private readonly dataProvider: IPortfolioDataProvider,
        private readonly tradeExecutor: ITradeExecutor,
        private readonly stateStore: IStateStore,
        private readonly logger: ILogger,
        private readonly config: PortfolioConfig,
    ) { }

    /**
     * Execute the initial portfolio buy-in.
     *
     * @param force  If true, skip the existing-state safety check.
     */
    async execute(force = false): Promise<void> {
        // ── Safety check ──────────────────────────────────────────────────
        if (!force && (await this.stateStore.exists())) {
            this.logger.error(
                "State file already exists! Portfolio may have already been initialized. " +
                "Use --force to override (DANGER: may duplicate positions).",
            );
            return;
        }

        this.logger.info(
            "═══════════════════════════════════════════════════════════════",
        );
        this.logger.info(
            "🚀 INITIALIZING PORTFOLIO — First-time setup",
        );
        this.logger.info(
            "═══════════════════════════════════════════════════════════════",
        );

        // ── Fetch available balance ───────────────────────────────────────
        const availableUSDT = await this.dataProvider.getAvailableBalance();
        this.logger.info(
            `💰 Available USDT balance: $${availableUSDT.toFixed(2)}`,
        );

        const availableNotionalPower = availableUSDT * this.config.leverage;

        if (availableUSDT < (this.config.totalBalanceUSDT / this.config.leverage) * 0.95) {
            this.logger.warn(
                `Available collateral ($${availableUSDT.toFixed(2)}) allows $${availableNotionalPower.toFixed(2)} notional. ` +
                `This is less than 95% of target $${this.config.totalBalanceUSDT.toFixed(2)}. Proceeding with available maximum.`,
            );
        }

        const effectiveBalance = Math.min(availableNotionalPower, this.config.totalBalanceUSDT);

        // ── Set leverage for all assets ────────────────────────────────────
        if (this.config.useFutures) {
            for (const asset of this.config.assets) {
                try {
                    await this.tradeExecutor.setLeverage(
                        asset.symbol,
                        this.config.leverage,
                    );
                    this.logger.debug(
                        `Leverage set to ${this.config.leverage}x for ${asset.symbol}`,
                    );
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.logger.error(
                        `Failed to set leverage for ${asset.symbol}`,
                        error,
                    );
                }
            }
        }

        // ── Execute initial buys ──────────────────────────────────────────
        const tradeResults: TradeResult[] = [];
        let totalSpent = 0;

        for (const asset of this.config.assets) {
            const buyAmountUSDT = effectiveBalance * asset.targetWeight;

            if (buyAmountUSDT < 5) {
                this.logger.warn(
                    `Skipping ${asset.symbol}: allocation $${buyAmountUSDT.toFixed(2)} below minimum`,
                );
                continue;
            }

            if (this.config.dryRun) {
                this.logger.trade(
                    `[DRY RUN] BUY $${buyAmountUSDT.toFixed(2)} of ${asset.symbol} ` +
                    `(${(asset.targetWeight * 100).toFixed(1)}% allocation)`,
                );
                totalSpent += buyAmountUSDT;
            } else {
                try {
                    this.logger.trade(
                        `Buying $${buyAmountUSDT.toFixed(2)} of ${asset.symbol} ` +
                        `(${(asset.targetWeight * 100).toFixed(1)}% allocation)...`,
                    );

                    const result = await this.tradeExecutor.executeMarketOrder(
                        asset.symbol,
                        "BUY",
                        buyAmountUSDT,
                    );
                    tradeResults.push(result);
                    totalSpent += buyAmountUSDT;

                    this.logger.success(
                        `${result.status}: Bought ${result.executedQty} ${asset.symbol} @ $${result.executedPrice.toFixed(2)}`,
                    );

                    // Small delay between orders to avoid rate limiting
                    await this.sleep(500);
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.logger.error(
                        `Failed to buy ${asset.symbol}`,
                        error,
                    );
                }
            }
        }

        // ── Save initial state ────────────────────────────────────────────
        const initialState = createInitialBotState(effectiveBalance);
        initialState.lastCheckTimestamp = Date.now();
        initialState.lastRebalanceTimestamp = Date.now();

        await this.stateStore.save(initialState);

        this.logger.info(
            "═══════════════════════════════════════════════════════════════",
        );
        this.logger.success(
            `Portfolio initialized! Total spent: $${totalSpent.toFixed(2)} across ${this.config.assets.length} assets`,
        );
        this.logger.info(
            `   State saved. Next rebalance check in ${(this.config.rebalanceIntervalSeconds / 86400).toFixed(0)} days.`,
        );
        this.logger.info(
            "═══════════════════════════════════════════════════════════════",
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
