import { describe, it, expect, beforeEach } from "vitest";
import { RsiEmaTrendBot } from "./RsiEmaTrendBot";
import { Position } from "../models/Position";
import { RsiEmaTrendStrategy, OHLCV } from "../strategy/RsiEmaTrendStrategy";

describe("RsiEmaTrend Strategy and Bot Edge Cases", () => {
  let bot: RsiEmaTrendBot;

  beforeEach(() => {
    bot = new RsiEmaTrendBot({
      symbol: "BTCUSDT",
      initial_balance: 1000,
      fee_pct: 0.1,
      trend_period: 10,
      rsi_period: 4,
      rsi_sma_period: 3,
      rsi_ob_os_lookback: 2,
      max_exposure: 50,
      max_dd_exit: 10, // 10%
      trailing_stop: 5,
      move_sl_to_be_at_pct: 2,
      exit_on_trend_reversal: true,
    });
  });

  const createOhlcv = (close: number, timestamp: number): OHLCV => ({
    timestamp,
    open: close,
    high: close + 5,
    low: close - 5,
    close,
    volume: 100,
  });

  const generateData = (closes: number[]): OHLCV[] => {
    return closes.map((c, i) => createOhlcv(c, i * 1000));
  };

  it("should enforce lookback excludes current candle and validate RSI cross", () => {
    const strategy = new RsiEmaTrendStrategy({
      emaPeriod: 10,
      rsiPeriod: 4,
      rsiSmaPeriod: 3,
      oversoldThreshold: 40,
      overboughtThreshold: 60,
      confirmationLookback: 2,
      slPct: 1.5,
      tpPct: 6.0,
    });

    const closes = Array(30).fill(100);
    closes.push(50, 45, 150, 200, 250);

    const data = generateData(closes);
    let signalStr = "NONE";
    for (let i = 12; i < data.length; i++) {
      const slice = data.slice(0, i + 1);
      const sig = strategy.checkSignal(slice);
      if (sig.signal === "LONG") {
        signalStr = "LONG";
        break;
      }
    }
    expect(signalStr).toBe("LONG");
  });

  it("should size positions using percentage of current balance (max_exposure)", () => {
    bot.balance = 2000;

    (bot as any)._open_position(
      "LONG",
      10000,
      Date.now(),
      9000,
      11000,
      50,
      "TEST",
    );

    expect(bot.balance).toBeCloseTo(1000, 0);
  });

  it("should halt trading on max drawdown exit", () => {
    bot.balance = 1000;
    bot.equity_curve = [1000];
    (bot as any)._peak_equity = 1000;

    (bot as any)._open_position(
      "LONG",
      100,
      Date.now(),
      90,
      110,
      100,
      "ENTRY_1",
    );

    expect(bot.positions.length).toBe(1);

    bot.on_candle(Date.now(), 100, 101, 85, 85, 1000, []);

    expect(bot.positions.length).toBe(0);
    expect(bot.halted_by_dd).toBe(true);

    bot.on_candle(Date.now() + 1000, 85, 86, 84, 85, 1000, []);
    expect(bot.positions.length).toBe(0);
  });

  it("should skip same-candle SL/TP checks (realism fix)", () => {
    bot.on_candle(Date.now(), 100, 105, 95, 100, 1000, []);

    const pos = new Position(100, 1, 105, 95, 0, "LONG");
    pos.meta = { opened_at_candle: (bot as any)._candle_counter + 1 };
    bot.positions.push(pos);

    bot.on_candle(Date.now(), 100, 105, 90, 100, 1000, []);

    expect(bot.positions.length).toBe(1); // STILL OPEN because it skipped!
  });

  it("should update trailing stop", () => {
    (bot as any)._exit_on_reversal = false;
    bot.balance = 1000;
    const pos = new Position(100, 1, 150, 90, 0, "LONG");
    pos.meta = { opened_at_candle: -1 };
    bot.positions.push(pos);

    bot.on_candle(Date.now(), 100, 120, 100, 100, 1000, []);

    expect(bot.positions[0].stop_loss_price).toBe(114);
  });

  it("should update break-even stop", () => {
    (bot as any)._exit_on_reversal = false;
    const pos = new Position(100, 1, 150, 90, 0, "LONG");
    pos.meta = { opened_at_candle: -1 };
    bot.positions.push(pos);

    bot.on_candle(Date.now(), 100, 103, 101, 102, 1000, []);

    expect(bot.positions[0].stop_loss_price).toBe(100); // BE
  });

  it("should exit on trend reversal", () => {
    bot = new RsiEmaTrendBot({
      symbol: "BTCUSDT",
      initial_balance: 1000,
      fee_pct: 0.1,
      trend_period: 5,
      exit_on_trend_reversal: true,
    });
    for (let i = 0; i < 10; i++) {
      bot.on_candle(i * 1000, 100, 100, 100, 100, 1000, []);
    }

    const pos = new Position(100, 1, 150, 40, 0, "LONG");
    pos.meta = { opened_at_candle: -1 };
    bot.positions.push(pos);

    // close < EMA -> Reversal exit
    bot.on_candle(Date.now(), 100, 100, 50, 50, 1000, []);

    expect(bot.positions.length).toBe(0);
    expect(bot.trade_log[bot.trade_log.length - 1].reason).toBe("REVERSAL");
  });

  it("should calculate round-trip PnL and fee correctly for exact balances", () => {
    bot.balance = 1000;
    (bot as any).fee_pct = 0.04;
    (bot as any).leverage = 1;

    // BUY 1 BTC @ $1000. Balance was 1000. Max exposure 100%.
    // Factor = 1 / 1 + 0.04 / 100 = 1.0004
    // Notional = 1000 / 1.0004 = 999.6001599360256
    // Using simple round numbers: qty = 1 BTC at $100
    bot.balance = 200;

    // Manual position opening to keep it clean:
    const entryPrice = 100;
    const qty = 1; // Notional = 100
    const margin = 100;
    const fee_entry = 100 * (0.04 / 100); // 0.04
    bot.balance -= margin + fee_entry; // 200 - 100.04 = 99.96

    const pos = new Position(entryPrice, qty, 150, 50, 0, "LONG");
    pos.meta = { opened_at_candle: -1, margin };
    bot.positions.push(pos);

    // Manual exit at $110
    const exitPrice = 110;
    const notional_exit = 110;
    const fee_exit = 110 * (0.04 / 100); // 0.044

    const expected_pnl = 110 - 100 - fee_exit; // 10 - 0.044 = 9.956
    const expected_balance = 99.96 + margin + expected_pnl; // 99.96 + 100 + 9.956 = 209.916

    (bot as any)._market_sell(pos, exitPrice, "TP", Date.now());

    expect(bot.balance).toBeCloseTo(expected_balance, 5);
  });
});
