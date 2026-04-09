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
    /** Drift threshold in absolute percentage points (e.g. 10 means ±10%) */
    driftThresholdPct: number;
    /** Profit harvest ceiling – auto-sell if any asset exceeds this % of portfolio */
    profitHarvestCeilingPct: number;
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

    return errors;
}
