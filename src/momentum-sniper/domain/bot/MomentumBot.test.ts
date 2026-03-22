import { describe, it, expect, beforeEach } from "vitest";
import { MomentumBot } from "./MomentumBot";
import { Position } from "../../../models/Position";

describe("MomentumBot", () => {
  let bot: MomentumBot;

  beforeEach(() => {
    bot = new MomentumBot({
      initial_balance: 1000,
      trend_period: 50
    });
  });

  it("should initialize with correct balance", () => {
    expect(bot.balance).toBe(1000);
    expect(bot.initial_balance).toBe(1000);
  });

  it("should update timestamps on first candle", () => {
    const timestamp = Date.now();
    const history = Array.from({ length: 100 }, () => 100);
    bot.on_candle(timestamp, 100, 105, 95, 101, 1000, history, Array(100).fill(1000));

    const summary = bot.summary();
    expect(summary.period).toContain(new Date(timestamp).toLocaleDateString());
  });

  it("should place momentum entry when all conditions met", () => {
    bot = new MomentumBot({
        initial_balance: 1000,
        trend_period: 50,
        rsi_threshold: 30 
    });
    
    const closes = Array.from({ length: 100 }, () => 100);
    const volumes = Array.from({ length: 100 }, () => 1000);
    const highs = Array.from({ length: 100 }, () => 105);
    const lows = Array.from({ length: 100 }, () => 95);

    // Push prices down to trigger RSI < 30
    for(let i=0; i<20; i++) {
        closes.push(90 - i);
        volumes.push(2000); 
        highs.push(90 - i + 1);
        lows.push(90 - i - 1);
    }

    // Force price above EMA to pass trend filter but RSI stays low
    // Wait, if price is dropping, it might be below EMA.
    // Let's set trend_period to something that makes EMA very slow to respond.
    // Or just make sure current price > ema.
    const currentPrice = 110; // Jump back up
    bot.on_candle(Date.now(), currentPrice, currentPrice + 1, currentPrice - 1, currentPrice, 3000, closes, volumes, highs, lows);

    expect(bot.positions.length).toBe(1);
  });

  it("should tiered exit: partial TP1 and move SL to BE", () => {
    bot = new MomentumBot({
        initial_balance: 1000,
        trend_period: 50,
        move_sl_to_be_at_pct: 10.0
    });
    const pos = new Position(100, 10, 150, 90, 0); 
    pos.meta = {}; // Ensure meta exists
    bot.positions.push(pos);
    bot.balance = 0;

    // Price hits 110 (10% gain)
    bot.on_candle(Date.now(), 110, 111, 109, 110, 1000, Array(100).fill(100), Array(100).fill(100));

    expect(pos.quantity).toBe(5); 
    expect(pos.stop_loss_price).toBe(100); 
  });

  it("should trailing exit: close if price falls below EMA 9 after TP1", () => {
    bot = new MomentumBot({
        initial_balance: 1000,
        trend_period: 50
    });
    const pos = new Position(100, 5, 150, 100, 0);
    pos.meta = { tp1_hit: true };
    bot.positions.push(pos);
    
    const closes = Array.from({ length: 100 }, () => 120);
    bot.on_candle(Date.now(), 115, 116, 114, 115, 1000, closes, Array(100).fill(100));

    expect(bot.positions.length).toBe(0);
  });

  it("should liquidate all on emergency drawdown", () => {
    bot = new MomentumBot({
      initial_balance: 1000,
      max_drawdown_exit_pct: 10.0,
    });

    const history = Array.from({ length: 100 }, () => 100);
    // Manually add a position
    bot.positions.push(new Position(100, 9, 150, 80, 0)); // 900 cost
    bot.balance = 100;
    
    // Price drops to 85. Equity = 100 + 9 * 85 = 865. (13.5% DD)
    bot.on_candle(2000, 85, 86, 84, 85, 1000, history, Array(100).fill(100));

    expect(bot.positions.length).toBe(0);
    expect(bot.trade_log.some((t) => t.reason === "emergency_dd_exit")).toBe(true);
  });
});
