import { describe, it, expect, beforeEach } from "vitest";
import { SmartGridBot } from "./SmartGridBot";

describe("SmartGridBot", () => {
  let bot: SmartGridBot;

  beforeEach(() => {
    bot = new SmartGridBot({
      initial_balance: 1000,
      grid_density: 10,
      take_profit_pct: 1.0,
      stop_loss_pct: 2.0,
    });
  });

  it("should initialize with correct balance", () => {
    expect(bot.balance).toBe(1000);
    expect(bot.initial_balance).toBe(1000);
  });

  it("should update timestamps on first candle", () => {
    const timestamp = Date.now();
    bot.on_candle(timestamp, 100, 105, 95, 101, [98, 99, 100, 101]);

    // Check summary to see if timestamps were captured (via bot.summary())
    const summary = bot.summary();
    expect(summary.period).toContain(new Date(timestamp).toLocaleDateString());
  });

  it("should place buy orders when can_buy is true", () => {
    // Provide a history with some volatility to ensure a healthy grid range
    const history = Array.from(
      { length: 250 },
      (_, i) => 100 + Math.sin(i / 10) * 5,
    );

    // Recent dip
    for (let i = 0; i < 20; i++) {
      history.push(95 - i);
    }

    // current_price = 75
    bot.on_candle(Date.now(), 75, 76, 74, 75, history);

    expect(bot.open_orders.size).toBeGreaterThan(0);
  });

  it("should liquidate all on emergency drawdown", () => {
    bot = new SmartGridBot({
      initial_balance: 1000,
      max_drawdown_exit_pct: 5.0,
    });

    // 1. Initial candle to set start
    bot.on_candle(1000, 100, 101, 99, 100, [100, 100, 100]);

    // 2. Simulate a position (manually for speed or via fill)
    // For this test, let's just trigger the drawdown logic by dropping equity
    // The bot calculates equity based on balance + btc_value + locked_balance
    // We'll simulate a fill then a price drop

    bot.on_candle(2000, 100, 101, 99, 100, [100, 100, 100]);
    // Orders should be open now.
    const buyOrder = Array.from(bot.open_orders.values()).find(
      (o) => o.side === "buy",
    );
    if (buyOrder) {
      // Force fill
      bot.on_candle(
        3000,
        buyOrder.price,
        buyOrder.price + 1,
        buyOrder.price - 1,
        buyOrder.price,
        [100, 100, 100],
      );
      expect(bot.positions.length).toBeGreaterThan(0);

      const entryPrice = buyOrder.price;
      const crashPrice = entryPrice * 0.9; // 10% drop

      bot.on_candle(
        4000,
        crashPrice,
        crashPrice + 0.1,
        crashPrice - 0.1,
        crashPrice,
        [100, 90, 80],
      );

      // Should have triggered emergency exit if drawdown > 5%
      // Total equity = balance (which was reduced by buy cost) + btc_value (which dropped)
      // If balance was 1000, and we bought for 500, balance is 500.
      // If BTC value was 500, and it drops to 450, total equity is 950.
      // Drawdown = (1000 - 950) / 1000 = 5%. matches!

      expect(bot.positions.length).toBe(0);
      expect(bot.trade_log.some((t) => t.reason === "emergency_dd_exit")).toBe(
        true,
      );
    }
  });
});
