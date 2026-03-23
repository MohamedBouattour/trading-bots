import { Order } from "../models/Order";
import { Position } from "../models/Position";
import { Trade } from "../models/Trade";
import { BotConfig } from "../models/BotConfig";
import { IBot, BotSummary } from "./IBot";

export abstract class BaseStrategyBot implements IBot {
  public readonly symbol: string;
  public readonly initial_balance: number;
  public readonly fee_pct: number;
  public readonly leverage: number;
  public readonly use_futures: boolean;

  public balance: number;
  public positions: Position[] = [];
  public equity_curve: number[];
  public sl_curve: (number | null)[] = [];
  public trade_log: Trade[] = [];
  public open_orders: Map<number, Order> = new Map();

  protected _peak_equity: number;
  protected _candle_counter: number = 0;
  protected _start_timestamp: number | null = null;
  protected _end_timestamp: number | null = null;
  protected _last_trade_candle: number = -1;
  public halted_by_dd: boolean = false;

  constructor(config: BotConfig) {
    this.symbol = config.symbol ?? "BTCUSDT";
    this.initial_balance = config.initial_balance ?? 1000.0;
    this.balance = this.initial_balance;
    this.fee_pct = config.fee_pct ?? 0.1;
    this.leverage = config.leverage ?? 1;
    this.use_futures = config.use_futures ?? false;

    this.equity_curve = [this.initial_balance];
    this._peak_equity = this.initial_balance;
  }

  abstract on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    closes_history: number[],
    volumes_history?: number[],
    highs_history?: number[],
    lows_history?: number[],
  ): void;

  protected _calculate_equity(current_close: number): number {
    return (
      this.balance +
      this.positions.reduce((s, p) => {
        const pnl =
          p.side === "LONG"
            ? (current_close - p.entry_price) * p.quantity
            : (p.entry_price - current_close) * p.quantity;
        const margin =
          (p.meta as any)?.margin ??
          (p.entry_price * p.quantity) / this.leverage;
        let effective_pnl = pnl;
        if (this.use_futures && pnl < -margin) {
          effective_pnl = -margin;
        }

        return s + margin + effective_pnl;
      }, 0)
    );
  }

  protected _update_equity(current_close: number): void {
    const equity = this._calculate_equity(current_close);
    if (equity > this._peak_equity) this._peak_equity = equity;
    this.equity_curve.push(equity);

    const current_sl =
      this.positions.length > 0 ? this.positions[0].stop_loss_price : null;
    this.sl_curve.push(current_sl);
  }

  protected _market_buy(
    price: number,
    timestamp: number,
    sl: number = 0,
    tp: number = 0,
    size_pct: number = 100.0,
    reason: string = "ENTRY",
  ): void {
    this._open_position("LONG", price, timestamp, sl, tp, size_pct, reason);
  }

  protected _open_position(
    side: "LONG" | "SHORT",
    price: number,
    timestamp: number,
    sl: number = 0,
    tp: number = 0,
    size_pct: number = 100.0,
    reason: string = "ENTRY",
  ): void {
    const equity = this._calculate_equity(price);
    const target_exposure = equity * (size_pct / 100);
    const max_budget = Math.min(this.balance, target_exposure);

    const factor = 1 / this.leverage + this.fee_pct / 100;
    const notional = max_budget / factor;
    const qty = notional / price;
    const margin = notional / this.leverage;
    const fee = (notional * this.fee_pct) / 100;

    if (margin <= 0 || margin + fee > this.balance + 1e-9) return;

    this.balance -= margin + fee;
    const pos = new Position(price, qty, tp, sl, 0, side);
    pos.meta = { opened_at_candle: this._candle_counter, margin };
    this.positions.push(pos);
    this.trade_log.push({
      timestamp,
      side: side === "LONG" ? "buy" : "sell",
      price,
      quantity: qty,
      reason,
      stop_loss: sl,
      take_profit: tp,
    });
  }

  protected _market_sell(
    pos: Position,
    price: number,
    reason: string,
    timestamp: number,
    split_qty: number | null = null,
  ): void {
    const qty_to_sell =
      split_qty !== null ? Math.min(pos.quantity, split_qty) : pos.quantity;
    const notional_entry = pos.entry_price * qty_to_sell;
    const notional_exit = price * qty_to_sell;
    const fee_exit = (notional_exit * this.fee_pct) / 100;
    // fee_entry was already paid at position opening

    const pnl =
      pos.side === "LONG"
        ? notional_exit - notional_entry - fee_exit
        : notional_entry - notional_exit - fee_exit;

    // Return the original margin portion for this qty
    const qty_ratio = qty_to_sell / pos.quantity;
    const margin_back =
      ((pos.meta as any)?.margin ?? notional_entry / this.leverage) * qty_ratio;

    this.balance += margin_back + pnl;

    // Log trade
    this.trade_log.push({
      timestamp,
      side: pos.side === "LONG" ? "sell" : "buy",
      price,
      quantity: qty_to_sell,
      reason,
      pnl,
      stop_loss: pos.stop_loss_price,
      take_profit: pos.take_profit_price,
    });

    if (split_qty !== null && split_qty < pos.quantity) {
      pos.quantity -= split_qty;
    } else {
      const idx = this.positions.indexOf(pos);
      if (idx !== -1) this.positions.splice(idx, 1);
    }
  }

  public close_all_positions(
    price: number,
    timestamp: number,
    update_last_equity: boolean = true,
  ): void {
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      this._market_sell(pos, price, "END_OF_DATA", timestamp);
    }
    this.positions = [];
    const equity = this.balance;
    if (equity > this._peak_equity) this._peak_equity = equity;

    if (update_last_equity) {
      this.equity_curve[this.equity_curve.length - 1] = equity;
    }
  }

  public summary(): BotSummary {
    const final_equity = this.equity_curve[this.equity_curve.length - 1];
    const profit = final_equity - this.initial_balance;
    const roi = (profit / this.initial_balance) * 100;
    let max_dd = 0;
    let peak = this.equity_curve[0];
    for (const eq of this.equity_curve) {
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > max_dd) max_dd = dd;
    }

    // Fix: filter closing trades only (those with a defined pnl).
    // This correctly handles both LONG exits (side='sell') and SHORT exits (side='buy').
    const closing_trades = this.trade_log.filter((t) => t.pnl !== undefined);
    const wins = closing_trades.filter((t) => (t.pnl ?? 0) > 0).length;

    return {
      period: `${new Date(this._start_timestamp ?? 0).toLocaleDateString()} to ${new Date(this._end_timestamp ?? 0).toLocaleDateString()}`,
      duration: `${Math.ceil(((this._end_timestamp ?? 0) - (this._start_timestamp ?? 0)) / 86400000)} days`,
      initial_balance: `${this.initial_balance.toFixed(2)} $`,
      final_value: `${final_equity.toFixed(2)} $`,
      total_profit: `${profit.toFixed(2)} $`,
      roi_pct: `${roi.toFixed(2)} %`,
      total_trades: closing_trades.length,
      max_drawdown_pct: `${(max_dd * 100).toFixed(2)} %`,
      win_rate: `${closing_trades.length > 0 ? ((wins / closing_trades.length) * 100).toFixed(2) : "0"} %`,
    };
  }

  public abstract get_config(): BotConfig;

  public toJSON(): string {
    return JSON.stringify({
      symbol: this.symbol,
      initial_balance: this.initial_balance,
      balance: this.balance,
      positions: this.positions,
      equity_curve: this.equity_curve,
      trade_log: this.trade_log,
      peak_equity: this._peak_equity,
      candle_counter: this._candle_counter,
      start_timestamp: this._start_timestamp,
      end_timestamp: this._end_timestamp,
      halted_by_dd: this.halted_by_dd,
    });
  }
}
