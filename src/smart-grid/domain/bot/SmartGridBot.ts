import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { GridStrategyConfig } from "../../../models/GridStrategyConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";
import { MathUtils } from "../../../shared/utils/MathUtils";

export interface BotSummary {
  period: string;
  duration: string;
  initial_balance: string;
  final_value: string;
  total_profit: string;
  roi_pct: string;
  total_trades: number;
  max_drawdown_pct: string;
}

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
  max_exposure_pct: number;
  max_drawdown_exit_pct: number;

  private _order_counter: number = 0;
  open_orders: Map<number, Order> = new Map();
  positions: Position[] = [];
  grid_levels: number[] = [];
  grid_lower: number = 0.0;
  grid_upper: number = 0.0;
  trend: "uptrend" | "downtrend" | "ranging" = "ranging";
  equity_curve: number[];
  trade_log: Trade[] = [];
  private _peak_equity: number;
  private _emergency_exit: boolean = false;
  private _start_timestamp: number | null = null;
  private _end_timestamp: number | null = null;

  constructor(config: GridStrategyConfig = {}) {
    this.symbol = config.symbol ?? "BTC/USDT";
    this.initial_balance = config.initial_balance ?? 500.0;
    this.balance = this.initial_balance;
    this.grid_density = config.grid_density ?? 100;
    this.qty_per_order = config.qty_per_order ?? 0.0;
    this.volatility_lookback = config.volatility_lookback ?? 24;
    this.trend_period = config.trend_period ?? 200;
    this.trend_threshold = config.trend_threshold ?? 0.002;
    this.take_profit_pct = config.take_profit_pct ?? 0.8;
    this.stop_loss_pct = config.stop_loss_pct ?? 2.0;
    this.trailing_stop_pct = config.trailing_stop_pct ?? 0;
    this.martingale_factor = config.martingale_factor ?? 3.0;
    this.max_exposure_pct = config.max_exposure_pct ?? 60;
    this.max_drawdown_exit_pct = config.max_drawdown_exit_pct ?? 10.0;

    this.equity_curve = [this.initial_balance];
    this._peak_equity = this.initial_balance;
  }

  private _next_id(): number {
    this._order_counter += 1;
    return this._order_counter;
  }

  public on_candle(
    timestamp: number,
    open_: number,
    high: number,
    low: number,
    close: number,
    closes_history: number[],
  ): void {
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

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
    const sma50 = IndicatorService.computeSMA(closes_history, 50);
    const rsi = IndicatorService.computeRSI(closes_history, 14);

    this.trend = trend;

    // Regime detection
    const is_bull_market = close > sma200;
    const is_golden_cross = sma50 > sma200; // medium-term bullish
    const is_strong_downtrend = trend === "downtrend" && !is_bull_market;

    // Inventory management
    const btc_held_qty = this.positions.reduce((sum, p) => sum + p.quantity, 0);
    const btc_value = btc_held_qty * close;

    let locked_balance = 0;
    for (const order of this.open_orders.values()) {
      if (order.side === "buy") {
        locked_balance += order.price * order.quantity;
      }
    }

    const current_total_equity = this.balance + btc_value + locked_balance;
    const exposure_pct = (btc_value / current_total_equity) * 100;

    // Track peak equity for drawdown-based exit
    if (current_total_equity > this._peak_equity) {
      this._peak_equity = current_total_equity;
    }
    const current_dd_pct =
      ((this._peak_equity - current_total_equity) / this._peak_equity) * 100;

    // Emergency de-risk: if drawdown exceeds threshold, liquidate everything
    if (
      this.max_drawdown_exit_pct > 0 &&
      current_dd_pct >= this.max_drawdown_exit_pct &&
      !this._emergency_exit
    ) {
      this._emergency_exit = true;
      this._cancel_all_orders();
      this._liquidate_all(close, timestamp, "emergency_dd_exit");
    }

    // Re-enable trading once drawdown recovers below half the threshold
    if (
      this._emergency_exit &&
      current_dd_pct < this.max_drawdown_exit_pct * 0.5
    ) {
      this._emergency_exit = false;
    }

    this._rebuild_grid(close, volatility, is_strong_downtrend, exposure_pct);
    this._simulate_fills(timestamp, low, high);
    this._manage_positions(timestamp, low, high, close, exposure_pct);
    this._cancel_stale_orders(close);

    // ── ENTRY FILTERS ──
    // Tighter RSI filter: only buy on real dips (RSI < 35) or confirmed uptrend
    // Never buy if RSI > 55 (avoid buying into resistance)
    // Respect max exposure limit
    const can_add_exposure = exposure_pct < this.max_exposure_pct;
    const rsi_allows =
      rsi < 35 || (trend === "uptrend" && is_golden_cross && rsi < 55);
    const not_in_crash = !is_strong_downtrend || rsi < 25; // only buy deep oversold in crash
    const can_buy =
      can_add_exposure && rsi_allows && not_in_crash && !this._emergency_exit;

    if (can_buy) {
      this._place_buy_orders(close, is_strong_downtrend);
    }

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
    const raw_qty = available_capital / levels_to_fill / current_price;

    // Ensure the baseline order size is at least a safe margin above Binance's 5.0 min notional
    const min_notional = 5.5;
    this.qty_per_order = Math.max(raw_qty, min_notional / current_price);

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

        // Skip placing orders below minNotional to avoid API rejection
        if (cost < 5.2) {
          // Adjust quantity to meet minimum if it's close, or skip. Here we just skip.
          continue;
        }

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

  private _simulate_fills(timestamp: number, low: number, high: number): void {
    const filled_ids: number[] = [];

    for (const [oid, order] of this.open_orders.entries()) {
      if (order.side === "buy" && low <= order.price && order.price <= high) {
        order.status = "filled";
        order.fill_price = order.price;
        filled_ids.push(oid);

        // Take profit price — just use the configured percentage
        const tp_price = order.price * (1 + this.take_profit_pct / 100);

        // Stop loss price
        const sl_price =
          this.stop_loss_pct > 0
            ? order.price * (1 - this.stop_loss_pct / 100)
            : 0;

        // Trailing stop: handled externally in _manage_positions, pass 0 to Position
        const pos = new Position(
          order.price,
          order.quantity,
          tp_price,
          sl_price,
          0,
        );
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
    timestamp: number,
    low: number,
    high: number,
    close: number,
    exposure_pct: number,
  ): void {
    const remaining: Position[] = [];

    for (const pos of this.positions) {
      let exited = false;
      let exit_price: number | null = null;
      let reason: string | null = null;

      // ── Update trailing stop: track highest price ──
      if (high > pos.highest_price_seen) {
        pos.highest_price_seen = high;
      }

      // ── Dynamic TP: tighten as exposure grows ──
      // When exposure is high (>40%), use 60% of normal TP to de-risk faster
      const exposure_tp_factor =
        exposure_pct > 40 ? 0.6 : exposure_pct > 25 ? 0.8 : 1.0;
      const base_tp = pos.take_profit_price;
      const adjusted_tp_from_exposure =
        pos.entry_price + (base_tp - pos.entry_price) * exposure_tp_factor;

      // In downtrend, tighten TP to 0.8% above entry to exit quickly
      const adjusted_tp =
        this.trend === "downtrend"
          ? Math.min(pos.entry_price * 1.008, adjusted_tp_from_exposure)
          : adjusted_tp_from_exposure;

      // ── CHECK 1: Take Profit ──
      if (high >= adjusted_tp) {
        exit_price = adjusted_tp;
        reason = "take_profit";
        exited = true;
      }

      // ── CHECK 2: Stop Loss (fixed) ──
      if (!exited && pos.stop_loss_price > 0 && low <= pos.stop_loss_price) {
        exit_price = pos.stop_loss_price;
        reason = "stop_loss";
        exited = true;
      }

      // ── CHECK 3: Trailing Stop ──
      if (
        !exited &&
        this.trailing_stop_pct > 0 &&
        pos.highest_price_seen > pos.entry_price
      ) {
        const trail_price =
          pos.highest_price_seen * (1 - this.trailing_stop_pct / 100);
        // Only activate trailing stop if we're in profit
        if (trail_price > pos.entry_price && low <= trail_price) {
          exit_price = trail_price;
          reason = "trailing_stop";
          exited = true;
        }
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

  public summary(): BotSummary {
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

    // Calculate duration
    let duration_str = "N/A";
    if (this._start_timestamp && this._end_timestamp) {
      const start = new Date(this._start_timestamp);
      const end = new Date(this._end_timestamp);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const diffMonths = (diffDays / 30.44).toFixed(1);
      duration_str = `${diffDays} days (~${diffMonths} months)`;
    }

    return {
      period: `${new Date(this._start_timestamp ?? 0).toLocaleDateString()} to ${new Date(this._end_timestamp ?? 0).toLocaleDateString()}`,
      duration: duration_str,
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
    timestamp: number,
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
