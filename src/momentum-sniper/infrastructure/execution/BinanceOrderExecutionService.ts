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

  private useFutures: boolean = false;

  constructor(apiKey: string, apiSecret: string, useFutures: boolean = false) {
    this.useFutures = useFutures;
    this.client = Binance({
      apiKey,
      apiSecret,
      getTime: () => Date.now() + this.timeOffset,
    });
  }

  private exchangeInfo: BinanceExchangeInfo | null = null;
  private futuresExchangeInfo: any | null = null;

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

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!this.useFutures) return;
    await this.ensureTimeSync();
    try {
      console.log(`[Futures] Setting leverage to ${leverage}x for ${symbol}`);
      await this.client.futuresLeverage({
        symbol,
        leverage,
      });
      console.log(`[Futures] Leverage set to ${leverage}x.`);
    } catch (error) {
      console.error(`[Futures] Failed to set leverage:`, error);
    }
  }

  private async getSymbolFilters(symbol: string) {
    await this.ensureTimeSync();
    if (this.useFutures) {
      if (!this.futuresExchangeInfo) {
        this.futuresExchangeInfo = await this.client.futuresExchangeInfo();
      }
      const symbolInfo = this.futuresExchangeInfo!.symbols.find(
        (s: any) => s.symbol === symbol,
      );
      if (!symbolInfo)
        throw new Error(`Symbol ${symbol} not found in futures exchange info.`);

      const priceFilter = symbolInfo.filters.find(
        (f: any) => f.filterType === "PRICE_FILTER",
      );
      const lotSize = symbolInfo.filters.find(
        (f: any) => f.filterType === "LOT_SIZE",
      );

      return {
        tickSize: priceFilter?.tickSize || "0.01",
        stepSize: lotSize?.stepSize || "0.0001",
      };
    } else {
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
        `Opening ${this.useFutures ? "FUTURES" : "SPOT"} ${side} order for ${symbol}. Quote Amount: ${quoteQty}`,
      );

      if (this.useFutures) {
        // Futures don't always support quoteOrderQty, some require quantity
        // Let's use quantity for futures by calculating from price
        const allPrices = await this.client.prices();
        const priceData = allPrices.find((p: any) => p.symbol === symbol);
        if (!priceData) throw new Error(`Price for ${symbol} not found.`);
        const price = parseFloat(priceData.price);
        const { stepSize } = await this.getSymbolFilters(symbol);
        const quantity = this.roundByStep(quoteQty / price, stepSize);

        const orderOptions = {
          symbol: symbol,
          side: side as unknown as OrderSide,
          type: "MARKET" as OrderType,
          quantity: quantity,
        };

        console.log(
          `[Futures] Executing order: ${side} ${quantity} ${symbol} @ ~${price}`,
        );
        await this.client.futuresOrder(orderOptions);
      } else {
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
      if (this.useFutures) {
        const info = await this.client.futuresAccountInfo();
        return info.assets.map((a: any) => ({
          asset: a.asset,
          free: a.availableBalance,
          locked: "0", // Futures balance structure is different
        }));
      } else {
        const info = await this.client.accountInfo();
        return info.balances;
      }
    } catch (error) {
      console.error("Failed to fetch account info:", error);
      return [];
    }
  }

  async getFuturesPositions(): Promise<any[]> {
    if (!this.useFutures) return [];
    await this.ensureTimeSync();
    try {
      const info = await this.client.futuresAccountInfo();
      return info.positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
    } catch (error) {
      console.error("Failed to fetch futures positions:", error);
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
