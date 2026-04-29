import Binance, {
    BinanceRest,
    OrderSide,
    OrderType,
} from "binance-api-node";
import {
    IPortfolioDataProvider,
    PositionInfo,
} from "../../application/ports/IPortfolioDataProvider";
import {
    ITradeExecutor,
    TradeResult,
    SymbolConstraints,
} from "../../application/ports/ITradeExecutor";
import { ILogger } from "../../application/ports/ILogger";

// ── Internal Binance type helpers ───────────────────────────────────────

interface BinanceFilter {
    filterType: string;
    tickSize?: string;
    stepSize?: string;
    minQty?: string;
    notional?: string;
}

interface BinanceSymbolInfo {
    symbol: string;
    filters: BinanceFilter[];
}

interface BinanceFuturesExchangeInfo {
    symbols: BinanceSymbolInfo[];
}

// ── Adapter ─────────────────────────────────────────────────────────────

/**
 * Concrete adapter implementing both IPortfolioDataProvider and ITradeExecutor
 * via the Binance Futures API.
 */
export class BinanceFuturesPortfolioAdapter
    implements IPortfolioDataProvider, ITradeExecutor {
    private client: BinanceRest;
    private timeOffset = 0;
    private isTimeSynced = false;
    private exchangeInfoCache: BinanceFuturesExchangeInfo | null = null;
    private readonly logger: ILogger;

    constructor(apiKey: string, apiSecret: string, logger?: ILogger) {
        this.client = Binance({
            apiKey,
            apiSecret,
            getTime: () => Date.now() + this.timeOffset,
        });
        // Default fallback logger that uses console directly
        this.logger = logger ?? {
            debug: (msg: string) => console.log(msg),
            info: (msg: string) => console.log(msg),
            success: (msg: string) => console.log(msg),
            warn: (msg: string) => console.warn(msg),
            error: (msg: string, err?: Error) => console.error(msg, err?.message ?? ""),
            trade: (msg: string) => console.log(msg),
        };
    }

    // ── Time Sync ────────────────────────────────────────────────────────

    private async ensureTimeSync(): Promise<void> {
        if (this.isTimeSynced) return;
        try {
            const serverTime = await this.client.time();
            this.timeOffset = Number(serverTime) - Date.now();
            this.isTimeSynced = true;
            this.logger.debug(
                `Time synced with Binance. Offset: ${this.timeOffset}ms`,
            );
        } catch {
            this.logger.warn("Binance time sync failed, using local clock.");
        }
    }

    // ── IPortfolioDataProvider ───────────────────────────────────────────

    async getCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
        await this.ensureTimeSync();
        const prices = new Map<string, number>();

        const allPrices = await this.client.futuresPrices();

        // futuresPrices() returns Record<string, string>
        const priceRecord = allPrices as unknown as Record<string, string>;
        for (const sym of symbols) {
            const priceStr = priceRecord[sym];
            if (priceStr) {
                prices.set(sym, parseFloat(priceStr));
            }
        }
        return prices;
    }

    async getOpenPositions(): Promise<PositionInfo[]> {
        await this.ensureTimeSync();
        const accountInfo = await this.client.futuresAccountInfo();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (accountInfo.positions as any[])
            .filter(
                (p: { positionAmt: string }) =>
                    parseFloat(p.positionAmt) !== 0,
            )
            .map(
                (p: {
                    symbol: string;
                    positionAmt: string;
                    entryPrice: string;
                    markPrice: string;
                    unrealizedProfit: string;
                }) => ({
                    symbol: p.symbol,
                    quantity: Math.abs(parseFloat(p.positionAmt)),
                    entryPrice: parseFloat(p.entryPrice),
                    markPrice: parseFloat(p.markPrice),
                    unrealizedPnl: parseFloat(p.unrealizedProfit),
                }),
            );
    }

    async getAvailableBalance(): Promise<number> {
        await this.ensureTimeSync();
        const accountInfo = await this.client.futuresAccountInfo();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assets = (accountInfo as any).assets as {
            asset: string;
            availableBalance: string;
        }[];
        const usdt = assets?.find(
            (a: { asset: string }) => a.asset === "USDT",
        );
        return usdt ? parseFloat(usdt.availableBalance) : 0;
    }

    async getTotalEquity(): Promise<number> {
        await this.ensureTimeSync();
        const accountInfo = await this.client.futuresAccountInfo();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return parseFloat((accountInfo as any).totalWalletBalance || "0");
    }

    // ── ITradeExecutor ──────────────────────────────────────────────────

    async executeMarketOrder(
        symbol: string,
        side: "BUY" | "SELL",
        amountUSDT: number,
    ): Promise<TradeResult> {
        await this.ensureTimeSync();

        // Get current price & symbol constraints
        const prices = await this.getCurrentPrices([symbol]);
        const price = prices.get(symbol);
        if (!price || price <= 0) {
            throw new Error(`Cannot get price for ${symbol}`);
        }

        const constraints = await this.getSymbolConstraints(symbol);
        const rawQty = amountUSDT / price;
        const quantity = this.roundByStep(rawQty, constraints.stepSize);

        if (parseFloat(quantity) <= 0) {
            throw new Error(
                `Calculated quantity for ${symbol} is zero after rounding (raw: ${rawQty}, step: ${constraints.stepSize})`,
            );
        }

        this.logger.trade(
            `${side} ${quantity} ${symbol} @ ~$${price.toFixed(2)} (notional: $${amountUSDT.toFixed(2)})`,
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orderResult: any = await this.client.futuresOrder({
            symbol,
            side: side as unknown as OrderSide,
            type: "MARKET" as OrderType,
            quantity,
        });

        const executedQty = parseFloat(orderResult.executedQty || orderResult.cumQty || "0");
        const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || String(price));

        if (executedQty === 0) {
            this.logger.error(`Trade executed but returned 0 quantity. Full response: ${JSON.stringify(orderResult)}`);
        }

        return {
            orderId: String(orderResult.orderId || "unknown"),
            symbol,
            side,
            executedQty,
            executedPrice: avgPrice,
            commission: amountUSDT * 0.0004,
            status: orderResult.status || "FILLED",
        };
    }

    async setLeverage(symbol: string, leverage: number): Promise<void> {
        await this.ensureTimeSync();
        try {
            await this.client.futuresLeverage({ symbol, leverage });
            this.logger.debug(
                `Leverage set to ${leverage}x for ${symbol}`,
            );
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error(
                `Failed to set leverage for ${symbol}`,
                error,
            );
        }
    }

    async getSymbolConstraints(symbol: string): Promise<SymbolConstraints> {
        await this.ensureTimeSync();

        if (!this.exchangeInfoCache) {
            this.exchangeInfoCache =
                (await this.client.futuresExchangeInfo()) as unknown as BinanceFuturesExchangeInfo;
        }

        const symbolInfo = this.exchangeInfoCache.symbols.find(
            (s) => s.symbol === symbol,
        );
        if (!symbolInfo) {
            throw new Error(
                `Symbol ${symbol} not found in futures exchange info`,
            );
        }

        const priceFilter = symbolInfo.filters.find(
            (f) => f.filterType === "PRICE_FILTER",
        );
        const lotSize = symbolInfo.filters.find(
            (f) => f.filterType === "LOT_SIZE",
        );
        const minNotionalFilter = symbolInfo.filters.find(
            (f) => f.filterType === "MIN_NOTIONAL",
        );

        return {
            tickSize: priceFilter?.tickSize || "0.01",
            stepSize: lotSize?.stepSize || "0.0001",
            minQty: lotSize?.minQty || "0.0001",
            minNotional: parseFloat(minNotionalFilter?.notional || "5"),
        };
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /**
     * Round a value down to the nearest step size.
     * Floors the value to avoid "insufficient balance" rejections.
     */
    private roundByStep(value: number, step: string): string {
        const stepNum = parseFloat(step);
        if (isNaN(stepNum) || stepNum === 0) return value.toString();

        let precision = 0;
        if (step.includes(".")) {
            precision = step.split(".")[1].replace(/0+$/, "").length;
        }

        const multiplier = Math.pow(10, precision);
        const valInt = Math.round(value * multiplier);
        const stepInt = Math.round(stepNum * multiplier);

        const roundedInt = Math.floor(valInt / stepInt) * stepInt;
        const roundedVal = roundedInt / multiplier;

        return roundedVal.toFixed(precision);
    }
}
