import * as dotenv from "dotenv";
import { RunBacktestUseCase } from "../../application/usecases/RunBacktestUseCase";
import { BinanceMarketDataProvider } from "../../infrastructure/market_data/BinanceMarketDataProvider";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { SyntheticMarketDataProvider } from "../../infrastructure/market_data/SyntheticMarketDataProvider";
import { CompositeMarketDataProvider } from "../../infrastructure/market_data/CompositeMarketDataProvider";
import { HtmlReportGenerator } from "../../infrastructure/reporting/HtmlReportGenerator";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";

dotenv.config();

const CONFIG: GridStrategyConfig = {
  symbol: process.env.ASSET?.replace(/['"]/g, "") || "BTCUSDT",
  initial_balance: parseFloat(process.env.BALANCE || "500.0"),
  grid_density: 100,
  qty_per_order: 0.0,
  volatility_lookback: 24,
  trend_period: 200,
  trend_threshold: 0.002,
  take_profit_pct: 0.8,
  stop_loss_pct: 2,
  trailing_stop_pct: 0,
  martingale_factor: 3,
  max_exposure_pct: 60,
  max_drawdown_exit_pct: 10,
};

const LOCAL_CSV = "btcusdt_1h.csv";
const OUTPUT_CHART_HTML = "smart_backtest_results.html";

async function main() {
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

  // Use TIME_FRAME from .env if available
  const timeframe = process.env.TIME_FRAME?.replace(/['"]/g, "") || "1h";

  await runBacktestUseCase.execute(CONFIG, OUTPUT_CHART_HTML, 6, timeframe); // 6 months backtest
}

if (require.main === module) {
  main().catch(console.error);
}
