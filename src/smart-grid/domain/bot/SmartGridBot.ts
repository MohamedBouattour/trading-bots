import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";
import { MathUtils } from "../../../shared/utils/MathUtils";

export class SmartGridBot {
  symbol: string;
  balance: number;
  initial_balance: number;
  grid_density: number;
  qty_per_order: number;
  volatility_lookback: number;
  trend_period: number;
  trend_threshold: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  trailing_stop_pct: number;
  martingale_factor: number;

  private _order_counter: number = 0;
  open_orders: Map<number, Order> = new Map();
  positions: Position[] = [];
  grid_levels: number[] = [];
  grid_lower: number = 0.0;
  grid_upper: number = 0.0;
  trend: "uptrend" | "downtrend" | "ranging" = "ranging";
  equity_curve: number[];
  trade_log: Trade[] = [];

  constructor(config: GridStrategyConfig = {}) {
    this.symbol = config.symbol ?? "BTC/USDT";
    this.initial_balance = config.initial_balance ?? 10000.0;
    this.balance = this.initial_balance;
    this.grid_density = config.grid_density ?? 20;
    this.qty_per_order = config.qty_per_order ?? 0.0;
    this.volatility_lookback = config.volatility_lookback ?? 72;
    this.trend_period = config.trend_period ?? 50;
    this.trend_threshold = config.trend_threshold ?? 0.001;
    this.take_profit_pct = config.take_profit_pct ?? 1.5;
    this.stop_loss_pct = config.stop_loss_pct ?? 0.0;
    this.trailing_stop_pct = config.trailing_stop_pct ?? 0.0;
    this.martingale_factor = config.martingale_factor ?? 1.0;

    this.equity_curve = [this.initial_balance];
  }

  private _next_id(): number {
    this._order_counter += 1;
    return this._order_counter;
  }

  public on_candle(
    timestamp: any,
    open_: number,
    high: number,
    low: number,
    close: number,
    closes_history: number[],
  ): void {
    const trend = IndicatorService.computeTrend(
      closes_history,
      this.trend_period,
      this.trend_threshold,
    );
    const volatility = IndicatorService.computeVolatility(
      closes_history,
      this.volatility_lookback,
    );
    const sma200 = IndicatorService.computeSMA(closes_history, 200);
    const rsi = IndicatorService.computeRSI(closes_history, 14);

    this.trend = trend;

    // Regime detection
    const is_bull_market = close > sma200;
    const is_strong_downtrend = trend === "downtrend" && !is_bull_market;

    // Inventory management: how much of our initial balance is currently tied up in BTC?
    const btc_held_qty = this.positions.reduce((sum, p) => sum + p.quantity, 0);
    const btc_value = btc_held_qty * close;

    // Calculate funds locked in open buy orders
    let locked_balance = 0;
    for (const order of this.open_orders.values()) {
      if (order.side === "buy") {
        locked_balance += order.price * order.quantity;
      }
    }

    const current_total_equity = this.balance + btc_value + locked_balance;
    const exposure_pct = (btc_value / current_total_equity) * 100;

    this._rebuild_grid(close, volatility, is_strong_downtrend, exposure_pct);
    this._simulate_fills(timestamp, low, high, close);
    this._manage_positions(timestamp, low, high, close, exposure_pct);
    this._cancel_stale_orders(close);

    // Entry logic: "Oversold Collector"
    // 1. Never buy if RSI > 60 (don't buy the top)
    // 2. Only enter new grids if RSI < 40 or we are already in exposure.
    // 3. This avoids buying at the end of a pump.
    const is_extreme_oversold = rsi < 30;
    const can_add_exposure = exposure_pct < 85;

    let can_buy = can_add_exposure && (rsi < 40 || trend === "uptrend");

    if (can_buy) {
      this._place_buy_orders(close, is_strong_downtrend, exposure_pct);
    }

    // Position exit logic is handled in _manage_positions

    this.equity_curve.push(current_total_equity);
  }

  private _rebuild_grid(
    current_price: number,
    volatility: number,
    is_strong_downtrend: boolean,
    exposure_pct: number,
  ): void {
    const margin = (this.grid_upper - this.grid_lower) * 0.2;
    if (
      this.grid_levels.length > 0 &&
      current_price > this.grid_lower + margin &&
      current_price < this.grid_upper - margin
    ) {
      return;
    }

    // Adjust density: fewer levels in downtrend to avoid fast accumulation
    const effective_density = is_strong_downtrend
      ? Math.floor(this.grid_density * 0.6)
      : this.grid_density;

    // Scale range with volatility, but wider during crashes
    const range_multiplier = is_strong_downtrend ? 6.0 : 4.0;
    const half_range =
      current_price *
      volatility *
      range_multiplier *
      Math.sqrt(this.volatility_lookback);

    let bias = 0.0;
    if (this.trend === "uptrend") bias = half_range * 0.15;
    if (this.trend === "downtrend") bias = -half_range * 0.15;

    this.grid_lower = current_price - half_range + bias;
    this.grid_upper = current_price + half_range + bias;
    this.grid_levels = MathUtils.linspace(
      this.grid_lower,
      this.grid_upper,
      effective_density,
    );

    // Dynamic sizing: lower size as exposure increases
    const base_allocation = is_strong_downtrend ? 0.3 : 0.8;
    const size_reduction_factor = Math.max(0.2, 1 - exposure_pct / 100);
    const available_capital =
      this.balance * base_allocation * size_reduction_factor;

    const levels_to_fill = Math.max(1, Math.floor(effective_density / 2));
    this.qty_per_order = available_capital / levels_to_fill / current_price;

    this._cancel_all_orders();
  }

  private _cancel_all_orders(): void {
    for (const [oid, o] of this.open_orders.entries()) {
      this.balance += o.price * o.quantity;
      this.open_orders.delete(oid);
    }
  }

  private _place_buy_orders(
    current_price: number,
    is_strong_downtrend: boolean,
    exposure_pct: number,
  ): void {
    const buy_levels = this.grid_levels
      .filter((lvl) => lvl < current_price)
      .reverse();

    const existing_prices = new Set<number>();
    for (const order of this.open_orders.values()) {
      if (order.side === "buy") {
        existing_prices.add(this._round_price(order.price));
      }
    }

    // Limit number of grid levels to place orders for
    const max_levels = is_strong_downtrend ? 3 : 15;
    let placed = 0;

    for (const [idx, level] of buy_levels.entries()) {
      if (placed >= max_levels) break;

      const rounded_level = this._round_price(level);
      if (!existing_prices.has(rounded_level)) {
        // Martingale logic: increase size for deeper levels in the current grid
        const depth_factor = Math.pow(this.martingale_factor, idx);

        let multiplier = depth_factor;
        if (this.trend === "uptrend") multiplier *= 1.2;
        if (is_strong_downtrend) multiplier *= 0.5;

        const qty = this.qty_per_order * multiplier;
        const cost = level * qty;

        if (this.balance >= cost && qty > 0) {
          const oid = this._next_id();
          this.open_orders.set(oid, {
            order_id: oid,
            side: "buy",
            price: level,
            quantity: qty,
            status: "open",
          });
          this.balance -= cost;
          placed++;
        }
      }
    }
  }

  private _round_price(p: number): number {
    return Math.round(p * 100) / 100;
  }

  private _cancel_stale_orders(current_price: number): void {
    const stale: number[] = [];
    for (const [oid, o] of this.open_orders.entries()) {
      if (o.side === "buy" && o.price > current_price) {
        stale.push(oid);
      }
    }
    for (const oid of stale) {
      const o = this.open_orders.get(oid)!;
      this.open_orders.delete(oid);
      this.balance += o.price * o.quantity;
    }
  }

  private _simulate_fills(
    timestamp: any,
    low: number,
    high: number,
    close: number,
  ): void {
    const filled_ids: number[] = [];
    const grid_step =
      (this.grid_upper - this.grid_lower) /
      Math.max(1, this.grid_levels.length - 1);

    for (const [oid, order] of this.open_orders.entries()) {
      if (order.side === "buy" && low <= order.price && order.price <= high) {
        order.status = "filled";
        order.fill_price = order.price;
        filled_ids.push(oid);

        // Dynamic Take Profit: narrower when exposure is high to de-risk faster
        const tp_multiplier = 1.5;
        const tp_price =
          order.price +
          Math.max(
            grid_step,
            order.price * ((this.take_profit_pct * tp_multiplier) / 100),
          );

        const pos = new Position(order.price, order.quantity, tp_price, 0, 0);
        this.positions.push(pos);
        this.trade_log.push({
          timestamp: timestamp,
          side: "buy",
          price: order.price,
          quantity: order.quantity,
        });
      }
    }

    for (const oid of filled_ids) {
      this.open_orders.delete(oid);
    }
  }

  private _manage_positions(
    timestamp: any,
    low: number,
    high: number,
    close: number,
    exposure_pct: number,
  ): void {
    const remaining: Position[] = [];
    const sma200 = IndicatorService.computeSMA(this.equity_curve, 200); // Using SMA of equity for trailing stop

    // NEW: BEAR MARKET EXIT
    // If we are in a strong downtrend and price is below SMA200,
    // we should be very quick to exit even at minor profits or small losses if exposure is high.
    const is_extreme_bear =
      close < IndicatorService.computeSMA(this.equity_curve, 200) * 0.9; // Arbitrary crash detection

    for (const pos of this.positions) {
      let exited = false;
      let exit_price: number | null = null;
      let reason: string | null = null;

      // Tighten TP in bear markets
      const adjusted_tp =
        this.trend === "downtrend"
          ? pos.entry_price * 1.01
          : pos.take_profit_price;

      if (high >= adjusted_tp) {
        exit_price = Math.max(high, adjusted_tp);
        reason = "take_profit";
        exited = true;
      }

      if (exited && exit_price !== null) {
        const proceeds = exit_price * pos.quantity;
        this.balance += proceeds;
        this.trade_log.push({
          timestamp: timestamp,
          side: "sell",
          price: exit_price,
          quantity: pos.quantity,
          reason: reason,
          pnl: proceeds - pos.entry_price * pos.quantity,
        });
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;
  }

  public summary(): any {
    const final_equity =
      this.equity_curve.length > 0
        ? this.equity_curve[this.equity_curve.length - 1]
        : this.initial_balance;
    const profit = final_equity - this.initial_balance;
    const roi = (profit / this.initial_balance) * 100;

    let max_dd = 0;
    let peak = this.equity_curve[0] || this.initial_balance;
    for (const eq of this.equity_curve) {
      if (eq > peak) peak = eq;
      const drawdown = (peak - eq) / peak;
      if (drawdown > max_dd) max_dd = drawdown;
    }
    max_dd *= 100;

    const sells = this.trade_log.filter((t) => t.side === "sell");
    return {
      initial_balance: Number(this.initial_balance.toFixed(2)) + " $",
      final_value: Number(final_equity.toFixed(2)) + " $",
      total_profit: Number(profit.toFixed(2)) + " $",
      roi_pct: Number(roi.toFixed(2)) + " %",
      total_trades: sells.length,
      max_drawdown_pct: Number(max_dd.toFixed(2)) + " %",
    };
  }

  private _liquidate_all(
    current_price: number,
    timestamp: any,
    reason: string,
  ): void {
    for (const pos of this.positions) {
      const proceeds = current_price * pos.quantity;
      this.balance += proceeds;
      this.trade_log.push({
        timestamp: timestamp,
        side: "sell",
        price: current_price,
        quantity: pos.quantity,
        reason: reason,
        pnl: proceeds - pos.entry_price * pos.quantity,
      });
    }
    this.positions = [];
  }
}
