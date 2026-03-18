import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { BinanceOrderExecutionService } from "../../infrastructure/execution/BinanceOrderExecutionService";
import { RsiSmaCrossoverBot } from "../../domain/bot/RsiSmaCrossoverBot";
import { RsiEmaTrendBot } from "../../domain/bot/RsiEmaTrendBot";
import {
  TrendRiderBot,
  FixedTargetBot,
  DeepValueBot,
  PullbackRiderBot,
  VolatilitySwingBot,
  StructuralGridBot,
} from "../../domain/bot/StrategyBots";
import { IBot } from "../../domain/bot/IBot";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

// 1. SILENCE ALL WARNINGS (Must be at the very top)
process.env.NODE_NO_WARNINGS = "1";
// Silence dotenv tips
process.env.DOTENV_CONFIG_SILENT = "true";

const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: Error | string, ...args: unknown[]) {
  if (
    typeof warning === "string" &&
    (warning.includes("punycode") || warning.includes("DeprecationWarning"))
  )
    return;
  if (
    warning instanceof Error &&
    (warning.message.includes("punycode") ||
      warning.name === "DeprecationWarning")
  )
    return;
  return (
    originalEmitWarning as (warning: Error | string, ...args: unknown[]) => void
  )(warning, ...args);
} as (warning: Error | string, ...args: unknown[]) => void;

// 2. Load Config Silently
dotenv.config({ path: path.join(process.cwd(), ".env") });

const apiKey = process.env.API_KEY || "";
const apiSecret = process.env.SECRET_KEY || "";
const symbol = (process.env.ASSET || "SOL/USDT").replace(/['"]/g, "");
const symbolNormalized = symbol.replace("/", "");
const timeframe = (process.env.TIME_FRAME || "4h").replace(/['"]/g, "");
const STATE_FILE = path.join(
  process.cwd(),
  `state_${symbolNormalized.toLowerCase()}.json`,
);

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log(`🚀 MOMENTUM SNIPER | ${symbol} | ${timeframe}`);

  const marketData = new BinanceMarketDataProvider();
  const executor = new BinanceOrderExecutionService(apiKey, apiSecret);

  // 1. Fetch Latest Data
  const candles = await marketData.getHistoricalData(
    symbolNormalized,
    timeframe,
    300,
    1,
  );
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
    rsi_period: parseInt(process.env.RSI_PERIOD || "14"),
    rsi_sma_period: parseInt(process.env.RSI_SMA_PERIOD || "14"),
    rsi_under_sma_duration: parseInt(process.env.RSI_UNDER_SMA_DURATION || "5"),
    max_exposure_pct: parseFloat(process.env.MAX_EXPOSURE || "100.0"),
    move_sl_to_be_at_pct: parseFloat(process.env.MOVE_SL_TO_BE_AT_PCT || "8.0"),
    fee_pct: parseFloat(process.env.FEE_PCT || "0.1"),
  };

  const strategyName = (process.env.STRATEGY || "rsi_sma").toLowerCase();

  // 3. Load State
  let state: Record<string, any> | null = null;
  let bot: IBot;

  const createBot = (type: string, config: BotConfig): IBot => {
    switch (type) {
      case "trend_rider":
        return new TrendRiderBot(config);
      case "fixed_target":
        return new FixedTargetBot(config);
      case "deep_value":
        return new DeepValueBot(config);
      case "pullback_rider":
        return new PullbackRiderBot(config);
      case "volatility_swing":
        return new VolatilitySwingBot(config);
      case "structural_grid":
        return new StructuralGridBot(config);
      case "rsi_ema_trend":
        return new RsiEmaTrendBot(config);
      default:
        return new RsiSmaCrossoverBot(config);
    }
  };

  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (strategyName === "rsi_sma") {
      bot = RsiSmaCrossoverBot.fromJSON(JSON.stringify(state), config);
    } else {
      bot = createBot(strategyName, config);
      // For other bots, we might not have fromJSON, so we just initialize fresh or try to load state manually if needed
      // Most simple bots here don't have complex internal state yet
    }
    (bot as unknown as { initial_balance: number }).initial_balance =
      config.initial_balance ?? 1000;
  } else {
    log(
      `📦 Initializing fresh state for strategy: ${strategyName} (Silent Warmup)...`,
    );
    bot = createBot(strategyName, config);
    const closes = candles.map((c) => c.close);
    // Warm up indicators WITHOUT recording trades
    for (let i = 0; i < candles.length - 1; i++) {
      const c = candles[i];
      const historyUntilNow = closes.slice(0, i + 1);

      // Temporary disable trade logging for warmup
      const originalTradeLog = bot.trade_log;
      bot.trade_log = [];

      bot.on_candle(
        c.timestamp,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        historyUntilNow,
      );

      // Clear any simulated positions/trades during warmup
      bot.positions = [];
      bot.trade_log = originalTradeLog;
    }
  }

  // 4. REAL DATA SYNC
  let realUsdtBalance = bot.balance;
  let realAssetQty = bot.positions.length > 0 ? bot.positions[0].quantity : 0;

  if (apiKey && apiSecret && apiKey.length > 10) {
    try {
      const balances = await executor.getAccountBalances();
      const usdt = balances.find(
        (b: { asset: string; free: string }) => b.asset === "USDT",
      );
      const assetSymbol = symbol.split("/")[0];
      const asset = balances.find(
        (b: { asset: string; free: string; locked: string }) =>
          b.asset === assetSymbol,
      );

      if (usdt) {
        realUsdtBalance = parseFloat(usdt.free);
        bot.balance = realUsdtBalance;
      }
      if (asset) {
        realAssetQty = parseFloat(asset.free) + parseFloat(asset.locked);

        // SYNC POSITION STATE: If Binance says 0, but bot thinks it has a position, CLEAR IT.
        if (realAssetQty < 0.00001 && bot.positions.length > 0) {
          log(
            "⚠️ SYNC: Binance has 0 asset. Clearing " +
              symbol +
              " position from internal memory.",
          );
          bot.positions = [];
        }
        // If Binance HAS asset, but bot thinks it doesn't, we should ideally track it,
        // but for now, we'll just ensure the bot doesn't try to buy more than it can.
      } else if (bot.positions.length > 0) {
        log("⚠️ SYNC: Asset not found in account. Clearing internal position.");
        bot.positions = [];
        realAssetQty = 0;
      }
      log("✅ SYNC: Account data fetched from Binance.");
    } catch (_e) {
      log("⚠️ WARNING: Could not sync with Binance API.");
    }
  }

  // 5. Run Strategy Logic
  if (!state || state.last_processed_candle !== lastCandleTime) {
    const closes = candles.map((c) => c.close);
    const ema = IndicatorService.computeEMA(closes, config.trend_period || 100);
    const rsi = IndicatorService.computeRSI(closes, 14);

    log(
      `📊 MARKET: Price: ${lastCandle.close.toFixed(2)} | EMA(${config.trend_period}): ${ema.toFixed(2)} | RSI: ${rsi.toFixed(1)}`,
    );

    const prevPositionsCount = bot.positions.length;
    bot.on_candle(
      lastCandle.timestamp,
      lastCandle.open,
      lastCandle.high,
      lastCandle.low,
      lastCandle.close,
      lastCandle.volume,
      closes,
    );

    if (apiKey && apiSecret && apiKey.length > 10) {
      const currentPosCount = bot.positions.length;

      // Handle BUY
      if (currentPosCount > prevPositionsCount) {
        const newPos = bot.positions[bot.positions.length - 1];
        const usdtToSpend = newPos.quantity * newPos.entry_price;
        log(
          `🔥 SIGNAL: BUYING ${symbol} | Amount: ${usdtToSpend.toFixed(2)} USDT`,
        );
        await executor.openMarketOrder(symbolNormalized, "BUY", usdtToSpend);
      }

      // Handle SELL
      const lastTrade = bot.trade_log[bot.trade_log.length - 1];
      if (
        lastTrade &&
        lastTrade.side === "sell" &&
        lastTrade.timestamp === lastCandleTime
      ) {
        log(
          `💰 SIGNAL: SELLING ${symbol} @ ${lastTrade.price} | REASON: ${lastTrade.reason}`,
        );
        // For sells, we usually want to sell the specific asset quantity we have
        await executor.openMarketOrder(
          symbolNormalized,
          "SELL",
          lastTrade.quantity * lastTrade.price, // quoteOrderQty approach
        );
      }
    }

    const newState = JSON.parse(bot.toJSON());
    newState.last_processed_candle = lastCandleTime;
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), "utf8");
  }

  // 6. Final Portfolio Summary
  const assetValue = realAssetQty * currentPrice;
  const floatingBalance = realUsdtBalance + assetValue;
  const totalRoi =
    ((floatingBalance - bot.initial_balance) / bot.initial_balance) * 100;

  log(
    `💹 WALLET: ROI: ${totalRoi.toFixed(2)}% | Floating Bal: ${floatingBalance.toFixed(2)} USDT`,
  );
  log(`   ├─ Cash (USDT): ${realUsdtBalance.toFixed(2)}`);
  log(
    `   └─ Asset (${symbol.split("/")[0]}): ${realAssetQty.toFixed(4)} ($${assetValue.toFixed(2)})`,
  );

  log("✅ SUCCESS: Execution finished.");

  if (
    "gc" in global &&
    typeof (global as Record<string, any>).gc === "function"
  ) {
    (global as Record<string, any>).gc();
  }
}

main().catch((err) => {
  console.error("CRITICAL ERROR:", err);
  process.exit(1);
});
