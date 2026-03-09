import { describe, it, expect, beforeEach } from "vitest";
import { MomentumBot } from "./MomentumBot";
import { Position } from "../../../models/Position";

describe("MomentumBot", () => {
  let bot: MomentumBot;

  beforeEach(() => {
    bot = new MomentumBot({
      initial_balance: 1000,
    });
  });

  it("should initialize with correct balance", () => {
    expect(bot.balance).toBe(1000);
    expect(bot.initial_balance).toBe(1000);
  });

  it("should update timestamps on first candle", () => {
    const timestamp = Date.now();
    const history = Array.from({ length: 100 }, () => 100);
    bot.on_candle(timestamp, 100, 105, 95, 101, history, Array(100).fill(1000));

    const summary = bot.summary();
    expect(summary.period).toContain(new Date(timestamp).toLocaleDateString());
  });

  it("should place momentum entry when all conditions met", () => {
    // Uptrend: Price > EMA 50
    // Momentum: Price > EMA 9, EMA 21
    // Confirmation: EMA 9 > EMA 21, RSI > 50, Vol > VolMA
    
    const closes = Array.from({ length: 100 }, () => 100);
    const volumes = Array.from({ length: 100 }, () => 1000);
    const highs = Array.from({ length: 100 }, () => 105);
    const lows = Array.from({ length: 100 }, () => 95);

    // Push prices up to trigger EMA cross and RSI > 50
    for(let i=0; i<20; i++) {
        closes.push(110 + i);
        volumes.push(2000); // Above average
        highs.push(110 + i + 1);
        lows.push(110 + i - 1);
    }

    const currentPrice = closes[closes.length - 1];
    volumes[volumes.length - 1] = 3000; // Force volume to be above average
    bot.on_candle(Date.now(), currentPrice, currentPrice + 1, currentPrice - 1, currentPrice, closes, volumes, highs, lows);

    expect(bot.open_orders.size).toBe(1);
    const order = Array.from(bot.open_orders.values())[0];
    expect(order.side).toBe("buy");
  });

  it("should tiered exit: partial TP1 and move SL to BE", () => {
    const pos = new Position(100, 10, 110, 90, 0); // entry 100, qty 10, tp1 110, sl 90
    bot.positions.push(pos);
    bot.balance = 0;

    // Price hits 110
    bot.on_candle(Date.now(), 110, 111, 109, 110, Array(100).fill(100), Array(100).fill(100));

    expect(pos.quantity).toBe(5); // 50% closed
    expect(pos.stop_loss_price).toBe(100); // SL moved to Break-even
    expect(bot.balance).toBeGreaterThan(500); // 5 * 110 = 550 minus fees
  });

  it("should trailing exit: close if price falls below EMA 9 after TP1", () => {
    const pos = new Position(100, 5, 110, 100, 0);
    pos.meta = { tp1_hit: true, tp2_price: 130 };
    bot.positions.push(pos);
    
    const closes = Array.from({ length: 100 }, () => 120);
    // EMA 9 will be around 120
    
    // Price drops to 115 (below EMA 9)
    bot.on_candle(Date.now(), 115, 116, 114, 115, closes, Array(100).fill(100));

    expect(bot.positions.length).toBe(0);
    expect(bot.trade_log.some(t => t.reason === "ema_trailing_exit")).toBe(true);
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
    bot.on_candle(2000, 85, 86, 84, 85, history, Array(100).fill(100));

    expect(bot.positions.length).toBe(0);
    expect(bot.trade_log.some((t) => t.reason === "emergency_dd_exit")).toBe(true);
  });
});
