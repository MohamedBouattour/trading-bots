import Binance, { BinanceRest, OrderSide, OrderType, TimeInForce } from "binance-api-node";
import { IOrderExecutorPort, ExchangeOrder } from "../../domain/port/IOrderExecutorPort";
import { AssetBalance } from "../../domain/model/Balance";

interface BinanceFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  filters: BinanceFilter[];
}

/**
 * Binance REST adapter for the IOrderExecutorPort domain port.
 *
 * Responsibilities:
 *  - Time-sync with Binance server once per instance lifecycle.
 *  - Round price/quantity to exchange-mandated tick/step sizes.
 *  - Map Binance raw types to the domain's ExchangeOrder & AssetBalance types.
 */
export class BinanceOrderExecutor implements IOrderExecutorPort {
  private readonly client: BinanceRest;
  private timeOffset = 0;
  private isTimeSynced = false;
  private exchangeInfo: { symbols: BinanceSymbolInfo[] } | null = null;

  constructor(apiKey: string, apiSecret: string) {
    this.client = Binance({
      apiKey,
      apiSecret,
      getTime: () => Date.now() + this.timeOffset,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async ensureTimeSync(): Promise<void> {
    if (this.isTimeSynced) return;
    try {
      const serverTime = await this.client.time();
      this.timeOffset = Number(serverTime) - Date.now();
      this.isTimeSynced = true;
    } catch {
      // Fall back to local time silently
    }
  }

  private async getSymbolFilters(
    symbol: string,
  ): Promise<{ tickSize: string; stepSize: string }> {
    await this.ensureTimeSync();
    if (!this.exchangeInfo) {
      this.exchangeInfo = await this.client.exchangeInfo();
    }
    const info = this.exchangeInfo.symbols.find((s) => s.symbol === symbol);
    if (!info) throw new Error(`Symbol ${symbol} not found in exchange info.`);

    const priceFilter = info.filters.find((f) => f.filterType === "PRICE_FILTER");
    const lotSize = info.filters.find((f) => f.filterType === "LOT_SIZE");

    return {
      tickSize: priceFilter?.tickSize ?? "0.01",
      stepSize: lotSize?.stepSize ?? "0.0001",
    };
  }

  /** Floors a value to the nearest step and returns it as a precision-correct string. */
  private roundByStep(value: number, step: string): string {
    const stepNum = parseFloat(step);
    if (isNaN(stepNum) || stepNum === 0) return value.toString();

    const precision = step.includes(".")
      ? step.split(".")[1].replace(/0+$/, "").length
      : 0;

    const multiplier = Math.pow(10, precision);
    const roundedInt =
      Math.floor(Math.round(value * multiplier) / Math.round(stepNum * multiplier)) *
      Math.round(stepNum * multiplier);

    return (roundedInt / multiplier).toFixed(precision);
  }

  // ── IOrderExecutorPort implementation ──────────────────────────────────────

  async getAccountBalances(): Promise<AssetBalance[]> {
    await this.ensureTimeSync();
    const info = await this.client.accountInfo();
    return info.balances
      .filter((b) => parseFloat(b.free) + parseFloat(b.locked) > 0)
      .map((b) => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked),
      }));
  }

  async getOpenOrders(symbol: string): Promise<ExchangeOrder[]> {
    await this.ensureTimeSync();
    const orders = await this.client.openOrders({ symbol });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (orders as any[]).map((o) => ({
      orderId: Number(o.orderId),
      symbol: o.symbol,
      side: o.side as "BUY" | "SELL",
      price: parseFloat(o.price),
      origQty: parseFloat(o.origQty),
      status: o.status,
    }));
  }

  async placeLimitOrder(
    symbol: string,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
  ): Promise<void> {
    await this.ensureTimeSync();
    const { tickSize, stepSize } = await this.getSymbolFilters(symbol);
    const roundedPrice = this.roundByStep(price, tickSize);
    const roundedQty = this.roundByStep(quantity, stepSize);

    await this.client.order({
      symbol,
      side: side as unknown as OrderSide,
      type: OrderType.LIMIT,
      price: roundedPrice,
      quantity: roundedQty,
      timeInForce: "GTC" as TimeInForce,
    });
  }

  async cancelOrder(symbol: string, orderId: number): Promise<void> {
    await this.ensureTimeSync();
    await this.client.cancelOrder({ symbol, orderId });
  }
}
