export interface AssetConfig {
    /** Binance symbol, e.g. "MUUSDT" */
    symbol: string;
    /** Target allocation weight as a decimal, e.g. 0.25 = 25% */
    targetWeight: number;
}

export interface PortfolioConfig {
    /** Total initial portfolio balance in USDT */
    totalBalanceUSDT: number;
    /** Array of asset configurations */
    assets: AssetConfig[];
    /** Drift threshold in absolute percentage points (e.g. 3 means ±3%) */
    driftThresholdPct: number;
    /** Profit harvest ceiling – auto-sell if any asset exceeds this % of portfolio */
    profitHarvestCeilingPct: number;
    /**
     * Per-asset relative harvest buffer.
     * Triggers a harvest if any asset's weight exceeds (targetWeight*100 + bufferPct).
     * E.g. with buffer=8, MUUSDT (25% target) harvests at >33%.
     * Set to 0 to disable.
     */
    profitHarvestBufferPct?: number;
    /**
     * Portfolio-level ROI harvest threshold (%).
     * When total portfolio ROI >= this value, a partial harvest of all positions is triggered,
     * selling a proportional slice of each position to lock in gains as free margin.
     * E.g. 25 means: harvest when portfolio is up +25% from initial value.
     * Set to 0 to disable.
     */
    portfolioRoiHarvestPct?: number;
    /**
     * Minimum free margin to keep as a safety buffer (actual USDT, not notional).
     * Compound buys will not spend below this floor.
     * Default: 0 (no floor).
     */
    minFreeMarginUSDT?: number;
    /** How often (seconds) the bot checks the portfolio. Default: 2592000 (30 days) */
    rebalanceIntervalSeconds: number;
    /** Leverage for futures positions. 1 = spot-like */
    leverage: number;
    /** Whether to use Binance Futures (true) or Spot (false) */
    useFutures: boolean;
    /** If true, log planned actions but do NOT execute trades */
    dryRun: boolean;
    /** Taker fee as a percentage, e.g. 0.04 */
    feePct: number;
    /** Minimum free balance (notional USDT) to trigger compound investment. Default: 10 */
    compoundThresholdUSDT: number;
    /** Whether to auto-update totalBalanceUSDT to actual portfolio value each cycle */
    autoScale: boolean;
}

/**
 * Validates a PortfolioConfig and returns an array of error messages.
 * Returns an empty array if the config is valid.
 */
export function validatePortfolioConfig(config: PortfolioConfig): string[] {
    const errors: string[] = [];

    // Target weights must sum to ~1.0
    const weightSum = config.assets.reduce((sum, a) => sum + a.targetWeight, 0);
    if (Math.abs(weightSum - 1.0) > 0.001) {
        errors.push(
            `Target weights must sum to 1.0 (got ${weightSum.toFixed(4)})`,
        );
    }

    // Individual asset validation
    for (const asset of config.assets) {
        if (!asset.symbol || asset.symbol.trim().length === 0) {
            errors.push(`Asset symbol cannot be empty`);
        }
        if (asset.targetWeight <= 0 || asset.targetWeight > 1) {
            errors.push(
                `Invalid target weight for ${asset.symbol}: ${asset.targetWeight}`,
            );
        }
    }

    // Drift threshold bounds
    if (config.driftThresholdPct < 1 || config.driftThresholdPct > 50) {
        errors.push(
            `driftThresholdPct must be between 1 and 50 (got ${config.driftThresholdPct})`,
        );
    }

    // Profit harvest ceiling must exceed every individual target weight
    const maxWeight = Math.max(...config.assets.map((a) => a.targetWeight));
    if (config.profitHarvestCeilingPct / 100 <= maxWeight) {
        errors.push(
            `profitHarvestCeilingPct (${config.profitHarvestCeilingPct}%) must be greater than the highest target weight (${(maxWeight * 100).toFixed(1)}%)`,
        );
    }

    // profitHarvestBufferPct
    if (
        config.profitHarvestBufferPct !== undefined &&
        (config.profitHarvestBufferPct < 0 || config.profitHarvestBufferPct > 50)
    ) {
        errors.push(
            `profitHarvestBufferPct must be between 0 and 50 (got ${config.profitHarvestBufferPct})`,
        );
    }

    // portfolioRoiHarvestPct
    if (
        config.portfolioRoiHarvestPct !== undefined &&
        config.portfolioRoiHarvestPct < 0
    ) {
        errors.push(
            `portfolioRoiHarvestPct must be >= 0 (got ${config.portfolioRoiHarvestPct})`,
        );
    }

    // minFreeMarginUSDT
    if (
        config.minFreeMarginUSDT !== undefined &&
        config.minFreeMarginUSDT < 0
    ) {
        errors.push(
            `minFreeMarginUSDT must be >= 0 (got ${config.minFreeMarginUSDT})`,
        );
    }

    // Rebalance interval minimum
    if (config.rebalanceIntervalSeconds < 3600) {
        errors.push(`rebalanceIntervalSeconds must be >= 3600 (1 hour)`);
    }

    // Leverage
    if (config.leverage < 1) {
        errors.push(`leverage must be >= 1 (got ${config.leverage})`);
    }

    // Total balance
    if (config.totalBalanceUSDT <= 0) {
        errors.push(
            `totalBalanceUSDT must be positive (got ${config.totalBalanceUSDT})`,
        );
    }

    // Compound threshold
    if (
        config.compoundThresholdUSDT !== undefined &&
        config.compoundThresholdUSDT < 0
    ) {
        errors.push(
            `compoundThresholdUSDT must be >= 0 (got ${config.compoundThresholdUSDT})`,
        );
    }

    return errors;
}
