import Binance from "binance-api-node";
import { IOrderExecutor } from "../../ports/IOrderExecutor";

export class BinanceOrderExecutionService implements IOrderExecutor {
  private client: any;

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
      const currentPrice = (prices as any)[symbol];
      if (!currentPrice) {
        throw new Error(`Could not find price for symbol: ${symbol}`);
      }
      console.log(`Current price of ${symbol} is ${currentPrice}`);

      const orderOptions: any = {
        symbol: symbol,
        side: side,
        type: "MARKET",
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
