import Binance, { BinanceRest, OrderSide, OrderType } from "binance-api-node";
import { IOrderExecutor } from "../../ports/IOrderExecutor";

export class BinanceOrderExecutionService implements IOrderExecutor {
  private client: BinanceRest;

  constructor(apiKey: string, apiSecret: string) {
    this.client = Binance({
      apiKey,
      apiSecret,
      getTime: () => Date.now(),
    });
  }

  private exchangeInfo: any = null;

  private async getSymbolFilters(symbol: string) {
    if (!this.exchangeInfo) {
      this.exchangeInfo = await this.client.exchangeInfo();
    }
    const symbolInfo = this.exchangeInfo.symbols.find(
      (s: any) => s.symbol === symbol,
    );
    if (!symbolInfo)
      throw new Error(`Symbol ${symbol} not found in exchange info.`);

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
  }

  private roundByStep(value: number, step: string): string {
    const precision = step.indexOf("1") - step.indexOf(".");
    const p = precision < 0 ? 0 : precision;
    // Use floor to be safe with lot sizes
    const factor = Math.pow(10, p);
    return (Math.floor(value * factor) / factor).toFixed(p);
  }

  async openMarketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    quoteQty: number,
    testOnly: boolean = false,
  ): Promise<void> {
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
  ): Promise<any> {
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
        timeInForce: "GTC" as any,
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

  async getOpenOrders(symbol: string): Promise<any[]> {
    try {
      return await this.client.openOrders({ symbol });
    } catch (error: any) {
      console.error("Failed to fetch open orders:", error.message);
      return [];
    }
  }
}
