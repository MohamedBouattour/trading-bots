import { describe, it, expect, beforeEach } from "vitest";
import { RsiEmaTrendBot } from "./RsiEmaTrendBot";
import { Position } from "../../../models/Position";
import { RsiEmaTrendStrategy, OHLCV } from "../strategies/RsiEmaTrendStrategy";

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

    const closes = [
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      100,
      100, // warmup
      50,
      45,
      40, // Trigger oversold condition (RSI drops deeply)
      42,
      45,
      50,
      60, // Cross RSI > SMA and price > EMA
    ];

    const data = generateData(closes);
    const signal = strategy.checkSignal(data);

    // We expect LONG because it was oversold previously and now crossing
    expect(signal.signal).toBe("LONG");
  });

  it("should size positions using percentage of current balance (max_exposure)", () => {
    // Artificial high to force signal check via bot
    bot.balance = 2000;

    // Test _open_position logic directly or through on_candle mock
    (bot as any)._open_position(
      "LONG",
      10000,
      Date.now(),
      9000,
      11000,
      50,
      "TEST",
    );

    // 50% max exposure on 2000 balance -> 1000 budget
    // fee 0.1% -> math applies factor 1 + fee_pct/100
    // so notional = 1000 / 1.001 = 999.0009...
    // fee = 0.999
    // Available balance left around 2000 - 1000 = 1000
    expect(bot.balance).toBeCloseTo(1000, 0);

    // Initial balance shouldn't matter; it uses current available balance.
  });

  it("should halt trading on max drawdown exit", () => {
    bot.balance = 1000;
    bot.equity_curve = [1000];
    (bot as any)._peak_equity = 1000;

    // Simulate entry
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

    // Provide candle that plunges equity 15% (entry 100->85 without hitting SL yet since no SL checks)
    // Wait, on_candle checks DD first.
    bot.on_candle(Date.now(), 100, 101, 85, 85, 1000, []);

    // Position should be closed, halted should be true
    expect(bot.positions.length).toBe(0);
    expect(bot.halted_by_dd).toBe(true);

    // Attempt next candle: must remain halted
    bot.on_candle(Date.now() + 1000, 85, 86, 84, 85, 1000, []);
    expect(bot.positions.length).toBe(0); // Cannot trade
  });

  it("should skip same-candle SL/TP checks (realism fix)", () => {
    bot.on_candle(Date.now(), 100, 105, 95, 100, 1000, []);

    // Force a position exactly on this candle using same counter
    const pos = new Position(100, 1, 105, 95, 0, "LONG");
    pos.meta = { opened_at_candle: (bot as any)._candle_counter };
    bot.positions.push(pos);

    // process same candle again (for simulation logic check)
    const prevCandleId = (bot as any)._candle_counter;
    bot.on_candle(Date.now(), 100, 106, 94, 100, 1000, []); // Now candle_counter increments

    // SL/TP shouldn't fire if the IDs were same, but here we incremented so it will fire.
    // If we mock the ID to be the new one:
    pos.meta = { opened_at_candle: (bot as any)._candle_counter };
    // evaluate candle with extreme highs/lows that hit SL
    bot.on_candle(Date.now(), 100, 105, 90, 100, 1000, []); // It will skip because opened_at runs now!

    expect(bot.positions.length).toBe(1); // STILL OPEN because it skipped!
  });

  it("should update trailing stop", () => {
    bot.balace = 1000;
    // SL is at 90, TS is 5%.
    const pos = new Position(100, 1, 150, 90, 0, "LONG");
    pos.meta = { opened_at_candle: -1 }; // Force it to NOT skip this candle
    bot.positions.push(pos);

    // TS update happens after SL check if no exit.
    // High is 120 -> trail_sl = 120 * (1 - 0.05) = 114
    bot.on_candle(Date.now(), 100, 120, 100, 100, 1000, []);

    expect(bot.positions[0].stop_loss_price).toBe(114);
  });

  it("should update break-even stop", () => {
    const pos = new Position(100, 1, 150, 90, 0, "LONG");
    pos.meta = { opened_at_candle: -1 };
    bot.positions.push(pos);

    // move_sl_to_be_at_pct = 2%
    // High goes to 103 (3% > 2%), sl should move to 100
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
    // warmup history for EMA
    for (let i = 0; i < 10; i++) {
      bot.on_candle(i * 1000, 100, 100, 100, 100, 1000, []);
    }

    const pos = new Position(100, 1, 150, 90, 0, "LONG");
    pos.meta = { opened_at_candle: -1 };
    bot.positions.push(pos);

    // price drops heavily, close < EMA -> Reversal exit
    bot.on_candle(Date.now(), 100, 100, 50, 50, 1000, []);

    expect(bot.positions.length).toBe(0);
    expect(bot.trade_log[bot.trade_log.length - 1].reason).toBe("REVERSAL");
  });
});
