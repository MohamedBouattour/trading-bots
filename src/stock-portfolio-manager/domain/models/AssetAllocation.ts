export interface AssetAllocation {
    /** Binance symbol, e.g. "MUUSDT" */
    symbol: string;
    /** Target weight as a decimal, e.g. 0.25 */
    targetWeight: number;
    /** Calculated current weight as a decimal, e.g. 0.31 */
    currentWeight: number;
    /** Current value in USDT */
    currentValueUSDT: number;
    /** Target value in USDT (totalPortfolioValue × targetWeight) */
    targetValueUSDT: number;
    /** Number of contracts/coins held */
    positionQty: number;
    /** Latest market price */
    currentPrice: number;
    /** Drift in absolute percentage points: (currentWeight - targetWeight) × 100 */
    driftPct: number;
}
