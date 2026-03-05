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

      const prices = await this.client.prices();
      // Prices can be an object or an array depending on parameters, but usually it's an object from .prices()
      // Let's check the type feedback again: '{ symbol: string; price: string; }[]'
      const pricesArray = prices as unknown as {
        symbol: string;
        price: string;
      }[];
      const priceObj = pricesArray.find((p) => p.symbol === symbol);
      const currentPrice = priceObj?.price;

      if (!currentPrice) {
        throw new Error(`Could not find price for symbol: ${symbol}`);
      }
      console.log(`Current price of ${symbol} is ${currentPrice}`);

      const orderOptions = {
        symbol: symbol,
        side: side as unknown as OrderSide,
        type: OrderType.MARKET,
        quoteOrderQty: String(quoteQty),
      };

      if (testOnly) {
        console.log("--- TEST MODE: Sending test order ---");
        const result = await this.client.orderTest(orderOptions);
        console.log("Test Order Response:", result);
      } else {
        console.log("--- LIVE MODE: Sending market order ---");
        const result = await this.client.order(orderOptions);
        console.log("Live Order Response:", result);
      }
    } catch (error) {
      console.error(`Failed to execute order:`, error);
      throw error;
    }
  }
}
