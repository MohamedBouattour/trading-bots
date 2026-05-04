import Binance, { BinanceRest } from "binance-api-node";
import { IMarketDataProvider } from "../../application/ports/IMarketDataProvider";
import { ITradeExecutor, TradeResult, SymbolConstraints } from "../../application/ports/ITradeExecutor";
import { ILogger } from "../../application/ports/ILogger";
import { Candle } from "../../domain/models/Candle";
import { Timeframe } from "../../domain/models/StrategyBlueprint";

const TF_MAP: Record<Timeframe, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w"
};

type FuturesCandle = {
  openTime: number; open: string; high: string; low: string; close: string; volume: string;
};

type FuturesOrder = {
  orderId: number; executedQty: string; avgPrice: string; status: string;
};

type BinanceFilter = {
  filterType: string; stepSize?: string; tickSize?: string; minQty?: string; notional?: string;
};

type BinanceSymbolInfo = { symbol: string; filters: BinanceFilter[] };
type FuturesExchangeInfo = { symbols: BinanceSymbolInfo[] };

/**
 * Unified Binance Futures adapter.
 * Implements IMarketDataProvider + ITradeExecutor.
 * Pure exchange I/O — zero strategy logic.
 */
export class BinanceAdapter implements IMarketDataProvider, ITradeExecutor {
  private client: BinanceRest;
  private timeOffset = 0;
  private exchangeInfoCache: FuturesExchangeInfo | null = null;

  constructor(
    apiKey: string,
    apiSecret: string,
    private readonly logger: ILogger
  ) {
    this.client = Binance({
      apiKey,
      apiSecret,
      getTime: () => Date.now() + this.timeOffset,
    });
  }

  async syncTime(): Promise<void> {
    try {
      const info = await (this.client as unknown as { futuresTime: () => Promise<{ serverTime: number }> }).futuresTime();
      this.timeOffset = info.serverTime - Date.now();
      this.logger.debug(`[BinanceAdapter] Time synced. Offset: ${this.timeOffset}ms`);
    } catch {
      this.logger.warn("[BinanceAdapter] Time sync failed, using local time");
    }
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit = 200): Promise<Candle[]> {
    const raw = await (this.client as unknown as {
      futuresCandles: (opts: object) => Promise<FuturesCandle[]>
    }).futuresCandles({ symbol, interval: TF_MAP[timeframe], limit });

    return raw.map((c) => ({
      timestamp: c.openTime,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const prices = await (this.client as unknown as {
      futuresPrices: () => Promise<Record<string, string>>
    }).futuresPrices();
    return parseFloat(prices[symbol] ?? "0");
  }

  async getAvailableBalance(): Promise<number> {
    const balances = await (this.client as unknown as {
      futuresAccountBalance: () => Promise<Array<{ asset: string; availableBalance: string }>>
    }).futuresAccountBalance();
    const usdt = balances.find((b) => b.asset === "USDT");
    return usdt ? parseFloat(usdt.availableBalance) : 0;
  }

  async getTotalEquity(): Promise<number> {
    const info = await (this.client as unknown as {
      futuresAccountInfo: () => Promise<{ totalMarginBalance: string }>
    }).futuresAccountInfo();
    return parseFloat(info.totalMarginBalance);
  }

  async executeMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    amountUSDT: number
  ): Promise<TradeResult> {
    try {
      const price = await this.getCurrentPrice(symbol);
      const constraints = await this.getSymbolConstraints(symbol);
      const step = parseFloat(constraints.stepSize);
      const rawQty = amountUSDT / price;
      const qty = Math.floor(rawQty / step) * step;

      const order = await (this.client as unknown as {
        futuresOrder: (opts: object) => Promise<FuturesOrder>
      }).futuresOrder({
        symbol, side, type: "MARKET",
        quantity: qty.toFixed(8),
      });

      return {
        orderId: String(order.orderId),
        symbol,
        side,
        executedQty: parseFloat(order.executedQty),
        executedPrice: parseFloat(order.avgPrice),
        commission: 0,
        status: order.status === "FILLED" ? "FILLED" : "PARTIALLY_FILLED",
      };
    } catch (err) {
      this.logger.error(`[BinanceAdapter] executeMarketOrder failed: ${String(err)}`);
      return { orderId: "", symbol, side, executedQty: 0, executedPrice: 0, commission: 0, status: "FAILED" };
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await (this.client as unknown as {
      futuresLeverage: (opts: object) => Promise<void>
    }).futuresLeverage({ symbol, leverage });
  }

  async getSymbolConstraints(symbol: string): Promise<SymbolConstraints> {
    if (!this.exchangeInfoCache) {
      this.exchangeInfoCache = await (this.client as unknown as {
        futuresExchangeInfo: () => Promise<FuturesExchangeInfo>
      }).futuresExchangeInfo();
    }

    const sym = this.exchangeInfoCache.symbols.find((s) => s.symbol === symbol);
    if (!sym) return { minNotional: 5, stepSize: "0.001", tickSize: "0.01", minQty: "0.001" };

    const getFilter = (type: string) => sym.filters.find((f) => f.filterType === type);
    const lot = getFilter("LOT_SIZE");
    const tick = getFilter("PRICE_FILTER");
    const notional = getFilter("MIN_NOTIONAL");

    return {
      minNotional: parseFloat(notional?.notional ?? "5"),
      stepSize: lot?.stepSize ?? "0.001",
      tickSize: tick?.tickSize ?? "0.01",
      minQty: lot?.minQty ?? "0.001",
    };
  }
}
