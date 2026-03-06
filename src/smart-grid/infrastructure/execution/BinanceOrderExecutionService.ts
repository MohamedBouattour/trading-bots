import Binance, {
  BinanceRest,
  OrderSide,
  OrderType,
  TimeInForce,
} from "binance-api-node";
import { IOrderExecutor } from "../../ports/IOrderExecutor";

interface BinanceFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
}

interface BinanceSymbol {
  symbol: string;
  filters: BinanceFilter[];
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbol[];
}

export class BinanceOrderExecutionService implements IOrderExecutor {
  private client: BinanceRest;
  private timeOffset: number = 0;
  private isTimeSynced: boolean = false;

  constructor(apiKey: string, apiSecret: string) {
    this.client = Binance({
      apiKey,
      apiSecret,
      getTime: () => Date.now() + this.timeOffset,
    });
  }

  private exchangeInfo: BinanceExchangeInfo | null = null;

  private async ensureTimeSync() {
    if (!this.isTimeSynced) {
      try {
        const serverTime = await this.client.time();
        this.timeOffset = Number(serverTime) - Date.now();
        this.isTimeSynced = true;
        console.log(
          `[Binance] Time synchronized. Local offset: ${this.timeOffset}ms`,
        );
      } catch (_error) {
        console.warn("[Binance] Time sync failed, using local time.");
      }
    }
  }

  private async getSymbolFilters(symbol: string) {
    await this.ensureTimeSync();
    if (!this.exchangeInfo) {
      this.exchangeInfo = await this.client.exchangeInfo();
    }
    const symbolInfo = this.exchangeInfo!.symbols.find(
      (s: BinanceSymbol) => s.symbol === symbol,
    );
    if (!symbolInfo)
      throw new Error(`Symbol ${symbol} not found in exchange info.`);

    const priceFilter = symbolInfo.filters.find(
      (f: BinanceFilter) => f.filterType === "PRICE_FILTER",
    );
    const lotSize = symbolInfo.filters.find(
      (f: BinanceFilter) => f.filterType === "LOT_SIZE",
    );

    return {
      tickSize: priceFilter?.tickSize || "0.01",
      stepSize: lotSize?.stepSize || "0.0001",
    };
  }

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

    // Lot sizes must be floored to prevent insufficient balance rejection
    const roundedInt = Math.floor(valInt / stepInt) * stepInt;
    const roundedVal = roundedInt / multiplier;

    return roundedVal.toFixed(precision);
  }

  async openMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quoteQty: number,
    testOnly: boolean = false,
  ): Promise<void> {
    await this.ensureTimeSync();
    try {
      console.log(
        `Opening ${side} order for ${symbol}. Quote Amount: ${quoteQty}`,
      );

      // Market orders by quoteQty don't usually need precision rounding for the USDT amount,
      // but let's keep it clean.
      const orderOptions = {
        symbol: symbol,
        side: side as unknown as OrderSide,
        type: OrderType.MARKET,
        quoteOrderQty: quoteQty.toFixed(2),
      };

      if (testOnly) {
        console.log("--- TEST MODE: Sending test order ---");
        await this.client.orderTest(orderOptions);
      } else {
        console.log("--- LIVE MODE: Sending market order ---");
        await this.client.order(orderOptions);
      }
    } catch (error) {
      console.error(`Failed to execute order:`, error);
      throw error;
    }
  }

  async getAccountBalances(): Promise<
    { asset: string; free: string; locked: string }[]
  > {
    await this.ensureTimeSync();
    try {
      const info = await this.client.accountInfo();
      return info.balances;
    } catch (error) {
      console.error("Failed to fetch account info:", error);
      return [];
    }
  }

  async placeLimitOrder(
    symbol: string,
    side: "BUY" | "SELL",
    price: number,
    quantity: number,
    testOnly: boolean = false,
  ): Promise<unknown> {
    await this.ensureTimeSync();
    try {
      const { tickSize, stepSize } = await this.getSymbolFilters(symbol);
      const roundedPrice = this.roundByStep(price, tickSize);
      const roundedQty = this.roundByStep(quantity, stepSize);

      console.log(
        `Placing LIMIT ${side} for ${symbol} @ ${roundedPrice} qty: ${roundedQty} (Full precision was: ${price} @ ${quantity})`,
      );

      const orderOptions = {
        symbol: symbol,
        side: side as unknown as OrderSide,
        type: OrderType.LIMIT,
        price: roundedPrice,
        quantity: roundedQty,
        timeInForce: "GTC" as TimeInForce,
      };

      if (testOnly) {
        console.log("--- TEST MODE: Sending test limit order ---");
        return await this.client.orderTest(orderOptions);
      } else {
        console.log("--- LIVE MODE: Sending limit order ---");
        return await this.client.order(orderOptions);
      }
    } catch (error) {
      console.error(`Failed to place limit order:`, error);
      throw error;
    }
  }

  async cancelOrder(symbol: string, orderId: number): Promise<void> {
    await this.ensureTimeSync();
    try {
      console.log(`Cancelling order ${orderId} for ${symbol}`);
      await this.client.cancelOrder({
        symbol: symbol,
        orderId: orderId,
      });
    } catch (error) {
      console.error(`Failed to cancel order ${orderId}:`, error);
    }
  }

  async getOpenOrders(symbol: string): Promise<unknown[]> {
    await this.ensureTimeSync();
    try {
      return await this.client.openOrders({ symbol });
    } catch (error: unknown) {
      console.error("Failed to fetch open orders:", (error as Error).message);
      return [];
    }
  }
}
