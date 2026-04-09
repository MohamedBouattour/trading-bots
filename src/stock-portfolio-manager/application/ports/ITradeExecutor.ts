export interface TradeResult {
    /** Exchange-assigned order ID */
    orderId: string;
    /** Binance symbol */
    symbol: string;
    /** Trade direction */
    side: "BUY" | "SELL";
    /** Actually executed quantity in asset units */
    executedQty: number;
    /** Average execution price */
    executedPrice: number;
    /** Commission paid */
    commission: number;
    /** Order fill status */
    status: "FILLED" | "PARTIALLY_FILLED" | "FAILED";
}

export interface SymbolConstraints {
    /** Minimum notional value for an order */
    minNotional: number;
    /** Step size for quantity precision */
    stepSize: string;
    /** Tick size for price precision */
    tickSize: string;
    /** Minimum order quantity */
    minQty: string;
}

export interface ITradeExecutor {
    /** Execute a market order for a given USDT amount */
    executeMarketOrder(
        symbol: string,
        side: "BUY" | "SELL",
        amountUSDT: number,
    ): Promise<TradeResult>;

    /** Set leverage for a futures symbol */
    setLeverage(symbol: string, leverage: number): Promise<void>;

    /** Get exchange constraints for a symbol (min notional, step/tick size) */
    getSymbolConstraints(symbol: string): Promise<SymbolConstraints>;
}
