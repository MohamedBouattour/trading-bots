import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { MomentumBot } from "./MomentumBot";
import { LocalCsvMarketDataProvider } from "../../infrastructure/market_data/LocalCsvMarketDataProvider";
import { HtmlReportGenerator } from "../../infrastructure/reporting/HtmlReportGenerator";
import { BotConfig } from "../../../models/BotConfig";

describe("PAXG/USDT 15m Strategy Integration Test", () => {
  const TEST_CSV = "paxgusdt_15m_test.csv";
  const TEST_REPORT = "test_backtest_results.html";

  // GOLD SETTINGS (Aligned with Optimizer)
  const GOLD_CONFIG: BotConfig = {
    symbol: "PAXGUSDT",
    initial_balance: 1000,
    take_profit_pct: 6.0,
    stop_loss_pct: 3.0,
    rsi_threshold: 30,
    trend_period: 50,
    move_sl_to_be_at_pct: 20,
    exit_on_trend_reversal: true,
    fee_pct: 0.2,
    max_exposure_pct: 100
  };

  it("should replicate the 🥇 GOLD strategy performance on PAXG 15m data", async () => {
    // 1. Load Data
    const provider = new LocalCsvMarketDataProvider(TEST_CSV);
    const df = await provider.getHistoricalData("PAXGUSDT", "15m");
    expect(df.length).toBeGreaterThan(34000); 

    // 2. Setup Bot
    const bot = new MomentumBot(GOLD_CONFIG);
    const history: number[] = [];

    // 3. Execution Loop
    for (const row of df) {
      // on_candle expects history EXCLUDING current close
      bot.on_candle(
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        [...history] 
      );
      
      // history updated AFTER
      history.push(row.close);
      if (history.length > 300) history.shift();
    }

    // 4. Force Settlement
    const lastRow = df[df.length - 1];
    bot.close_all_positions(lastRow.close, lastRow.timestamp);

    // 5. Assertions
    const summary = bot.summary();
    const roi = parseFloat(summary.roi_pct.replace("%", ""));
    const trades = summary.total_trades;
    const winRate = parseFloat(summary.win_rate.replace("%", ""));

    console.log(`Test Summary: ROI: ${roi}%, Trades: ${trades}, WR: ${winRate}%`);

    // Expected: ROI ~70.21% (Matches optimizer output in terminal)
    expect(roi).toBeGreaterThan(65); 
    expect(trades).toBe(25);
    expect(winRate).toBeGreaterThan(60);

    // 6. Report Generation Test
    const reportGenerator = new HtmlReportGenerator();
    reportGenerator.generateReport(df, bot, TEST_REPORT);

    expect(fs.existsSync(TEST_REPORT)).toBe(true);
    const htmlContent = fs.readFileSync(TEST_REPORT, "utf8");
    
    expect(htmlContent.toUpperCase()).toContain("PAXGUSDT");
    expect(htmlContent).toContain("TP (+6.0%)");
    expect(htmlContent).toContain("TREND");
    expect(htmlContent).toContain("ROI");
  }, 30000);
});
