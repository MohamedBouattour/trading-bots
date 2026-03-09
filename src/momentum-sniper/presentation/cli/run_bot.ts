import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";
import { MomentumBot } from "../../domain/bot/MomentumBot";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

// 1. SILENCE ALL WARNINGS (Must be at the very top)
process.env.NODE_NO_WARNINGS = "1";
// Silence dotenv tips
process.env.DOTENV_CONFIG_SILENT = "true";

const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args: any[]) {
    if (typeof warning === 'string' && (warning.includes('punycode') || warning.includes('DeprecationWarning'))) return;
    if (warning instanceof Error && (warning.message.includes('punycode') || warning.name === 'DeprecationWarning')) return;
    return (originalEmitWarning as any)(warning, ...args);
} as any;

// 2. Load Config Silently
dotenv.config({ path: path.join(process.cwd(), ".env") });

const apiKey = process.env.API_KEY || "";
const apiSecret = process.env.SECRET_KEY || "";
const symbol = (process.env.ASSET || "SOL/USDT").replace(/['"]/g, "");
const symbolNormalized = symbol.replace("/", "");
const timeframe = (process.env.TIME_FRAME || "4h").replace(/['"]/g, "");
const STATE_FILE = path.join(process.cwd(), `state_${symbolNormalized.toLowerCase()}.json`);

function log(msg: string) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log(`🚀 MOMENTUM SNIPER | ${symbol} | ${timeframe}`);
  
  const marketData = new BinanceMarketDataProvider();
  const executor = new BinanceOrderExecutionService(apiKey, apiSecret);

  // 1. Fetch Latest Data
  const candles = await marketData.getHistoricalData(symbolNormalized, timeframe, 300, 1);
  if (candles.length === 0) {
    log("❌ ERROR: Failed to fetch market data.");
    return;
  }
  const lastCandle = candles[candles.length - 1];
  const lastCandleTime = lastCandle.timestamp;
  const currentPrice = lastCandle.close;

  // 2. Setup Bot Config
  const config: BotConfig = {
    symbol: symbolNormalized,
    initial_balance: parseFloat(process.env.BALANCE || "1000"),
    trend_period: parseInt(process.env.TREND_PERIOD || "100"),
    take_profit_pct: parseFloat(process.env.TAKE_PROFIT || "12.0"),
    stop_loss_pct: parseFloat(process.env.STOP_LOSS || "6.0"),
    rsi_threshold: parseFloat(process.env.RSI_THRESHOLD || "45.0"),
    max_exposure_pct: parseFloat(process.env.MAX_EXPOSURE || "100.0"),
    move_sl_to_be_at_pct: parseFloat(process.env.MOVE_SL_TO_BE_AT_PCT || "8.0"),
    fee_pct: parseFloat(process.env.FEE_PCT || "0.1"),
  };

  // 3. Load State
  let state: any = null;
  let bot: MomentumBot;
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    bot = MomentumBot.fromJSON(JSON.stringify(state), config);
    (bot as any).initial_balance = config.initial_balance; 
  } else {
    log("📦 Initializing fresh state...");
    bot = new MomentumBot(config);
    const closes = candles.map(c => c.close);
    for (let i = 0; i < candles.length - 1; i++) {
      const c = candles[i];
      bot.on_candle(c.timestamp, c.open, c.high, c.low, c.close, closes.slice(0, i + 1));
    }
  }

  // 4. REAL DATA SYNC
  let realUsdtBalance = bot.balance;
  let realAssetQty = bot.positions.length > 0 ? bot.positions[0].quantity : 0;

  if (apiKey && apiSecret && apiKey.length > 10) {
    try {
      const balances = await executor.getAccountBalances();
      const usdt = balances.find((b: any) => b.asset === "USDT");
      const assetSymbol = symbol.split('/')[0];
      const asset = balances.find((b: any) => b.asset === assetSymbol);
      
      if (usdt) {
          realUsdtBalance = parseFloat(usdt.free);
          bot.balance = realUsdtBalance;
      }
      if (asset) {
          realAssetQty = parseFloat(asset.free) + parseFloat(asset.locked);
      }
      log("✅ SYNC: Account data fetched from Binance.");
    } catch (e) {
      log("⚠️ WARNING: Could not sync with Binance API.");
    }
  }

  // 5. Run Strategy Logic
  if (!state || state.last_processed_candle !== lastCandleTime) {
    const closes = candles.map(c => c.close);
    const ema = IndicatorService.computeEMA(closes, config.trend_period || 100);
    const rsi = IndicatorService.computeRSI(closes, 14);
    const trend = lastCandle.close > ema ? "BULLISH 📈" : "BEARISH 📉";

    log(`📊 MARKET: Price: ${lastCandle.close.toFixed(2)} | EMA(${config.trend_period}): ${ema.toFixed(2)} | RSI: ${rsi.toFixed(1)}`);
    
    const prevPositionsCount = bot.positions.length;
    bot.on_candle(lastCandle.timestamp, lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close, closes);

    if (apiKey && apiSecret && apiKey.length > 10) {
      const currentPosCount = bot.positions.length;
      if (currentPosCount > prevPositionsCount) {
        const newPos = bot.positions[bot.positions.length - 1];
        log(`🔥 SIGNAL: BUY ${newPos.quantity.toFixed(4)} ${symbol} @ ${newPos.entry_price}`);
        await executor.placeMarketOrder(symbolNormalized, "BUY", newPos.quantity);
      } 
      const lastTrade = bot.trade_log[bot.trade_log.length - 1];
      if (lastTrade && lastTrade.side === "sell" && lastTrade.timestamp === lastCandleTime) {
        log(`💰 SIGNAL: SELL ${lastTrade.quantity.toFixed(4)} ${symbol} @ ${lastTrade.price} | REASON: ${lastTrade.reason}`);
        await executor.placeMarketOrder(symbolNormalized, "SELL", lastTrade.quantity);
      }
    }

    const newState = JSON.parse(bot.toJSON());
    newState.last_processed_candle = lastCandleTime;
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), "utf8");
  }

  // 6. Final Portfolio Summary
  const assetValue = realAssetQty * currentPrice;
  const floatingBalance = realUsdtBalance + assetValue;
  const totalRoi = ((floatingBalance - bot.initial_balance) / bot.initial_balance) * 100;

  log(`💹 WALLET: ROI: ${totalRoi.toFixed(2)}% | Floating Bal: ${floatingBalance.toFixed(2)} USDT`);
  log(`   ├─ Cash (USDT): ${realUsdtBalance.toFixed(2)}`);
  log(`   └─ Asset (${symbol.split('/')[0]}): ${realAssetQty.toFixed(4)} ($${assetValue.toFixed(2)})`);
  
  log("✅ SUCCESS: Execution finished.");
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((global as any).gc) (global as any).gc();
}

main().catch(err => {
  console.error("CRITICAL ERROR:", err);
  process.exit(1);
});
