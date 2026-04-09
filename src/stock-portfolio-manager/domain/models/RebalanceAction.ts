export type RebalanceReason =
    | "DRIFT_REBALANCE"
    | "PROFIT_HARVEST"
    | "REDISTRIBUTION";

export interface RebalanceAction {
    /** Binance symbol */
    symbol: string;
    /** Trade direction */
    side: "BUY" | "SELL";
    /** Dollar amount to trade */
    amountUSDT: number;
    /** Quantity in asset units */
    quantityAsset: number;
    /** Why this action was generated */
    reason: RebalanceReason;
    /** Current weight before the action (decimal) */
    fromWeight: number;
    /** Expected weight after the action (decimal) */
    toWeight: number;
}
