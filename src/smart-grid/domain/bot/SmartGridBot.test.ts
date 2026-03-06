import { describe, it, expect, beforeEach } from "vitest";
import { SmartGridBot } from "./SmartGridBot";
import { Position } from "../../../models/Position";

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
    bot.on_candle(timestamp, 100, 105, 95, 101, [98, 99, 100, 101], []);

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
    bot.on_candle(Date.now(), 75, 76, 74, 75, history, []);

    expect(bot.open_orders.size).toBeGreaterThan(0);
  });

  it("should liquidate all on emergency drawdown", () => {
    bot = new SmartGridBot({
      initial_balance: 1000,
      max_drawdown_exit_pct: 5.0,
    });

    // 1. Initial candle to set start
    bot.on_candle(1000, 100, 101, 99, 100, [100, 100, 100], []);

    // 2. Simulate a position (manually for speed or via fill)
    // For this test, let's just trigger the drawdown logic by dropping equity
    // The bot calculates equity based on balance + btc_value + locked_balance
    // We'll simulate a fill then a price drop

    bot.on_candle(2000, 100, 101, 99, 100, [100, 100, 100], []);
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
        [],
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
        [],
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

  it("martingale cap: order cost at level 5 must not exceed max_order_cost_pct of equity", () => {
    const customBot = new SmartGridBot({
      initial_balance: 1000,
      grid_density: 10,
      martingale_factor: 2.0, // Large multiplier
      max_order_cost_pct: 2.0, // strict 2% cap
      max_exposure_pct: 100,
    });
    // Forcing a large qty manually to see if cap trims it
    customBot.qty_per_order = 10;
    const history = Array.from({ length: 250 }, () => 100);
    // trigger buy orders on crash
    customBot.on_candle(Date.now(), 75, 76, 74, 75, history, []);

    let maxCost = 0;
    for (const o of customBot.open_orders.values()) {
      if (o.side === "buy") {
        const cost = o.price * o.quantity;
        if (cost > maxCost) maxCost = cost;
      }
    }
    // 2% of 1000 is 20
    expect(maxCost).toBeLessThanOrEqual(20.5);
  });

  it("TTL stale orders: buy order open > 48 candles with no fill must be cancelled", () => {
    const history = Array.from({ length: 250 }, () => 100);
    for (let i = 0; i < 20; i++) history.push(95 - i); // create crash
    bot.on_candle(1000, 75, 76, 74, 75, history, []);
    const ordersInitially = bot.open_orders.size;
    expect(ordersInitially).toBeGreaterThan(0);

    let foundStale = false;
    for (let i = 1; i <= 50; i++) {
      bot.on_candle(1000 + i * 1000, 105, 106, 104, 105, history, []);
      if (bot.open_orders.size < ordersInitially) foundStale = true;
    }

    expect(foundStale).toBe(true);
  });

  it("position dedup: two positions within 0.4% price diff must merge into one", () => {
    bot.positions.push(new Position(100, 1, 110, 90, 0));
    bot.positions.push(new Position(100.2, 1, 110, 90, 0)); // 0.2% diff
    bot.positions.push(new Position(105, 1, 115, 95, 0)); // ~5% diff

    // trigger dedup which runs at end of on_candle
    const history = Array.from({ length: 250 }, () => 100);
    bot.on_candle(Date.now(), 100, 101, 99, 100, history, []);

    // Should merge first two, leave third.
    const mergedPos = bot.positions.find((p) => p.quantity === 2);
    expect(mergedPos).toBeDefined();
    expect(mergedPos?.entry_price).toBeCloseTo(100.1, 3);
  });

  it("sell-side grid: after a buy fill, sell orders appear above current price", () => {
    bot.grid_lower = 50;
    bot.grid_upper = 150;
    bot.grid_levels = [95, 100, 105, 110, 115];
    bot.qty_per_order = 10;

    bot.positions.push(new Position(100, 10, 110, 90, 0)); // Give it inventory

    const history = Array.from({ length: 250 }, () => 100);
    bot.on_candle(Date.now(), 102, 103, 101, 102, history, []);

    let sellOrders = 0;
    for (const o of bot.open_orders.values()) {
      if (o.side === "sell") sellOrders++;
    }
    expect(sellOrders).toBeGreaterThan(0);
  });

  it("adaptive TP: tp_price must be higher in high-volatility regime vs low-volatility", () => {
    const lowVolBot = new SmartGridBot({
      initial_balance: 1000,
      take_profit_pct: 1.0,
    });
    const highVolBot = new SmartGridBot({
      initial_balance: 1000,
      take_profit_pct: 1.0,
    });

    const lowVolHistory = Array.from({ length: 150 }, () => 100);
    // Very flat
    lowVolBot.on_candle(1000, 100, 101, 99, 100, lowVolHistory, []);
    // Provide a buy fill, order.price = 99
    lowVolBot.open_orders.set(1, {
      order_id: 1,
      side: "buy",
      price: 99,
      quantity: 1,
      status: "open",
    });
    lowVolBot.on_candle(2000, 99, 99.5, 98.5, 99, lowVolHistory, []);
    const lowVolPos = lowVolBot.positions[0];

    const highVolHistory = Array.from(
      { length: 150 },
      (_, i) => 100 + Math.sin(i) * 20,
    );
    highVolBot.on_candle(1000, 100, 120, 80, 100, highVolHistory, []);
    highVolBot.open_orders.set(1, {
      order_id: 1,
      side: "buy",
      price: 99,
      quantity: 1,
      status: "open",
    });
    highVolBot.on_candle(2000, 99, 99.5, 98.5, 99, highVolHistory, []);
    const highVolPos = highVolBot.positions[0];

    expect(highVolPos.take_profit_price).toBeGreaterThan(
      lowVolPos.take_profit_price,
    );
  });
});
