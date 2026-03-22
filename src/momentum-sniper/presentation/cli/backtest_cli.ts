import * as dotenv from "dotenv";
import { RunBacktestUseCase } from "../../application/usecases/RunBacktestUseCase";
import { BinanceMarketDataProvider } from "../../infrastructure/adapters/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/adapters/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/adapters/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/adapters/market_data/CompositeMarketDataProvider";
import { HtmlReportGenerator } from "../../infrastructure/adapters/reporting/HtmlReportGenerator";
// Removed other bots to stick to the single RSI+EMA strategy on 4H BTCUSDT
import { RsiEmaTrendBot } from "../../domain/bot/RsiEmaTrendBot";
import { BotConfig } from "../../domain/models/BotConfig";
import { IBot } from "../../domain/bot/IBot";

dotenv.config();

const asset = process.env.ASSET?.replace(/['"]/g, "") || "BTC/USDT";
const symbol = asset.replace("/", "");
const symbolClean = symbol.toLowerCase();

// Defaults are aligned with the optimal backtest report:
//   RSI 7 | SL 1.5% | TP 6.0% | EMA 100 | RSI SMA 7
const CONFIG: BotConfig = {
  symbol: symbol,
  initial_balance: parseFloat(process.env.BALANCE || "500.0"),
  entry_density: parseInt(process.env.ENTRY_DENSITY || "100"),
  qty_per_order: parseFloat(process.env.QTY_PER_ORDER || "0.0"),
  volatility_lookback: parseInt(process.env.VOLATILITY_LOOKBACK || "24"),
  trend_period: parseInt(process.env.TREND_PERIOD || "100"), // was 200
  trend_threshold: parseFloat(process.env.TREND_THRESHOLD || "0.002"),
  take_profit_pct: parseFloat(process.env.TAKE_PROFIT || "6.0"), // was 0.8
  stop_loss_pct: parseFloat(process.env.STOP_LOSS || "1.5"), // was 2.0
  trailing_stop_pct: parseFloat(process.env.TRAILING_STOP || "0.0"),
  martingale_factor: parseFloat(process.env.MARTINGALE || "3.0"),
  max_exposure_pct: parseFloat(process.env.MAX_EXPOSURE || "60.0"),
  max_drawdown_exit_pct: parseFloat(process.env.MAX_DD_EXIT || "10.0"),
  fee_pct: parseFloat(process.env.FEE_PCT || "0.04"),
  rsi_threshold: parseFloat(process.env.RSI_THRESHOLD || "45.0"),
  rsi_period: parseInt(process.env.RSI_PERIOD || "7"), // was 14
  rsi_sma_period: parseInt(process.env.RSI_SMA_PERIOD || "7"), // was 14
  rsi_under_sma_duration: parseInt(process.env.RSI_UNDER_SMA_DURATION || "5"),
  rsi_above_sma_duration: parseInt(process.env.RSI_ABOVE_SMA_DURATION || "5"),
  move_sl_to_be_at_pct: parseFloat(process.env.MOVE_SL_TO_BE_AT_PCT || "0.0"),
  leverage: parseFloat(process.env.LEVERAGE || "1"),
  use_futures: process.env.USE_FUTURES === "true",
};

const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "4h";
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

  const bot: IBot = new RsiEmaTrendBot(CONFIG);
  const strategy = "rsi_ema_trend";
  console.log(`🤖 Strategy: ${strategy}`);
  const months = parseInt(process.env.MONTHS || "3");
  await runBacktestUseCase.execute(bot, OUTPUT_CHART_HTML, months, timeframe);
}

if (require.main === module) {
  main().catch(console.error);
}
