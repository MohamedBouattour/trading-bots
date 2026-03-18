import * as dotenv from "dotenv";
import { RunBacktestUseCase } from "../../application/usecases/RunBacktestUseCase";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { HtmlReportGenerator } from "../../infrastructure/reporting/HtmlReportGenerator";
import { RsiSmaCrossoverBot } from "../../domain/bot/RsiSmaCrossoverBot";
import {
  TrendRiderBot,
  FixedTargetBot,
  DeepValueBot,
  PullbackRiderBot,
  VolatilitySwingBot,
  StructuralGridBot,
} from "../../domain/bot/StrategyBots";
import { RsiEmaTrendBot } from "../../domain/bot/RsiEmaTrendBot";
import { BotConfig } from "../../../models/BotConfig";
import { IBot } from "../../domain/bot/IBot";

dotenv.config();

const asset = process.env.ASSET?.replace(/['"]/g, "") || "BTC/USDT";
const symbol = asset.replace("/", "");
const symbolClean = symbol.toLowerCase();

const CONFIG: BotConfig = {
  symbol: symbol,
  initial_balance: parseFloat(process.env.BALANCE || "500.0"),
  entry_density: parseInt(process.env.ENTRY_DENSITY || "100"),
  qty_per_order: parseFloat(process.env.QTY_PER_ORDER || "0.0"),
  volatility_lookback: parseInt(process.env.VOLATILITY_LOOKBACK || "24"),
  trend_period: parseInt(process.env.TREND_PERIOD || "200"),
  trend_threshold: parseFloat(process.env.TREND_THRESHOLD || "0.002"),
  take_profit_pct: parseFloat(process.env.TAKE_PROFIT || "0.8"),
  stop_loss_pct: parseFloat(process.env.STOP_LOSS || "2.0"),
  trailing_stop_pct: parseFloat(process.env.TRAILING_STOP || "0.0"),
  martingale_factor: parseFloat(process.env.MARTINGALE || "3.0"),
  max_exposure_pct: parseFloat(process.env.MAX_EXPOSURE || "60.0"),
  max_drawdown_exit_pct: parseFloat(process.env.MAX_DD_EXIT || "10.0"),
  fee_pct: parseFloat(process.env.FEE_PCT || "0.1"),
  rsi_threshold: parseFloat(process.env.RSI_THRESHOLD || "45.0"),
  rsi_period: parseInt(process.env.RSI_PERIOD || "14"),
  rsi_sma_period: parseInt(process.env.RSI_SMA_PERIOD || "14"),
  rsi_under_sma_duration: parseInt(process.env.RSI_UNDER_SMA_DURATION || "5"),
  move_sl_to_be_at_pct: parseFloat(process.env.MOVE_SL_TO_BE_AT_PCT || "0.0"),
};

const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "1h";
const LOCAL_CSV = `${symbolClean}_${timeframe}.csv`;
const OUTPUT_CHART_HTML = "smart_backtest_results.html";

async function main() {
  console.log(`🚀 Running backtest for ${symbol} with config from .env...`);
  console.log(`📊 Capital: $${CONFIG.initial_balance}`);
  console.log(`📁 Source: ${LOCAL_CSV}`);

  const localProvider = new LocalCsvMarketDataProvider(LOCAL_CSV);
  const apiProvider = new BinanceMarketDataProvider();
  const synthProvider = new SyntheticMarketDataProvider();

  const marketDataProvider = new CompositeMarketDataProvider(
    localProvider,
    apiProvider,
    synthProvider,
  );
  const reportGenerator = new HtmlReportGenerator();

  const runBacktestUseCase = new RunBacktestUseCase(
    marketDataProvider,
    reportGenerator,
  );

  let bot: IBot;
  const strategy = process.env.STRATEGY || "rsi_sma";

  switch (strategy.toLowerCase()) {
    case "trend_rider":
      bot = new TrendRiderBot(CONFIG);
      break;
    case "fixed_target":
      bot = new FixedTargetBot(CONFIG);
      break;
    case "deep_value":
      bot = new DeepValueBot(CONFIG);
      break;
    case "pullback_rider":
      bot = new PullbackRiderBot(CONFIG);
      break;
    case "volatility_swing":
      bot = new VolatilitySwingBot(CONFIG);
      break;
    case "structural_grid":
      bot = new StructuralGridBot(CONFIG);
      break;
    case "rsi_ema_trend":
      bot = new RsiEmaTrendBot(CONFIG);
      break;
    default:
      bot = new RsiSmaCrossoverBot(CONFIG);
  }

  console.log(`🤖 Strategy: ${strategy}`);
  const months = parseInt(process.env.MONTHS || "6");
  await runBacktestUseCase.execute(bot, OUTPUT_CHART_HTML, months, timeframe);
}

if (require.main === module) {
  main().catch(console.error);
}
