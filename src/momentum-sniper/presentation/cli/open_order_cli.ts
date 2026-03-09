import * as dotenv from "dotenv";
import * as path from "path";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";

dotenv.config({ path: path.join(__dirname, "../../../../.env") });

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return val;
}

const apiKey = getEnv("API_KEY");
const apiSecret = getEnv("SECRET_KEY");

const rawAsset = process.env.ASSET || "BTC/USDT";
const symbol = rawAsset.replace(/['"/]/g, "");
const balanceStr = process.env.BALANCE || "500";
const balanceToUse = parseFloat(balanceStr);

async function main() {
  console.log(`Starting Binance Client...`);
  console.log(`Target Symbol: ${symbol}`);
  console.log(`Balance to use: ${balanceToUse}`);

  const orderExecutor = new BinanceOrderExecutionService(apiKey, apiSecret);

  // NOTE: Passing 'true' below tests the API without spending real funds.
  // Change to 'false' if you want to execute real orders with real money.
  await orderExecutor.openMarketOrder(symbol, "BUY", balanceToUse, true);
}

if (require.main === module) {
  main().catch(console.error);
}
