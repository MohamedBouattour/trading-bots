export interface PositionInfo {
    /** Binance symbol, e.g. "MUUSDT" */
    symbol: string;
    /** Absolute position size (number of contracts/coins) */
    quantity: number;
    /** Average entry price */
    entryPrice: number;
    /** Current mark/market price */
    markPrice: number;
    /** Unrealized profit/loss in USDT */
    unrealizedPnl: number;
}

export interface IPortfolioDataProvider {
    /** Get current prices for the given symbols */
    getCurrentPrices(symbols: string[]): Promise<Map<string, number>>;

    /** Get all open futures positions (non-zero qty) */
    getOpenPositions(): Promise<PositionInfo[]>;

    /** Get available USDT balance (free, not locked in positions) */
    getAvailableBalance(): Promise<number>;

    /** Get total account equity (balance + unrealized PnL) */
    getTotalEquity(): Promise<number>;
}
