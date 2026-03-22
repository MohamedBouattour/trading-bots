import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

import { IBot, BotSummary } from "./IBot";

export class MomentumBot implements IBot {
  public readonly symbol: string;
  public readonly initial_balance: number;
  public readonly fee_pct: number;

  public balance: number;
  public positions: Position[] = [];
  public equity_curve: number[];
  public sl_curve: (number | null)[] = [];
  public trade_log: Trade[] = [];
  public open_orders: Map<number, Order> = new Map();

  private _peak_equity: number;
  private _candle_counter: number = 0;
  private _start_timestamp: number | null = null;
  private _end_timestamp: number | null = null;
  private _last_trade_candle: number = -1;

  // Strategy Params
  private _tp_pct: number;
  private _sl_pct: number;
  private _ts_pct: number;
  private _max_exposure_pct: number;
  private _trend_period: number;
  private _rsi_period: number;
  private _rsi_threshold: number;
  private _move_sl_to_be_at_pct: number;
  private _exit_on_trend_reversal: boolean;
  private _max_drawdown_exit_pct: number;

  constructor(config: BotConfig = {}) {
    this.symbol = config.symbol ?? "BTC/USDT";
    this.initial_balance = config.initial_balance ?? 1000.0;
    this.balance = this.initial_balance;
    this.fee_pct = config.fee_pct ?? 0.1;

    // NO DEFAULTS - USE CONFIG ONLY
    this._tp_pct = config.take_profit_pct ?? 10.0;
    this._sl_pct = config.stop_loss_pct ?? 3.0;
    this._ts_pct = config.trailing_stop_pct ?? 0.0;
    this._max_exposure_pct = config.max_exposure_pct ?? 100.0;
    this._trend_period = config.trend_period ?? 200;
    this._rsi_period = config.rsi_period ?? 14;
    this._rsi_threshold = config.rsi_threshold ?? 30;
    this._move_sl_to_be_at_pct = config.move_sl_to_be_at_pct ?? 0.0;
    this._exit_on_trend_reversal = !!config.exit_on_trend_reversal;
    this._max_drawdown_exit_pct = config.max_drawdown_exit_pct ?? 0.0;

    this.equity_curve = [this.initial_balance];
    this._peak_equity = this.initial_balance;
  }

  public on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    _volume: number,
    closes_history: number[],
    _volumes_history: number[] = [],
    _highs_history: number[] = [],
    _lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const current_close = close;

    // Emergency Drawdown Check
    const current_equity =
      this.balance +
      this.positions.reduce((s, p) => s + p.quantity * current_close, 0);
    const dd = (this._peak_equity - current_equity) / this._peak_equity;
    if (this._max_drawdown_exit_pct > 0 && dd * 100 >= this._max_drawdown_exit_pct) {
      for (const pos of [...this.positions]) {
        this._market_sell(pos, current_close, "emergency_dd_exit", timestamp);
      }
      this.positions = [];
    }

    // REQUIRED WARMUP CHECK - MUST BE trend_period
    if (closes_history.length < this._trend_period) return;

    // Indicators on confirmed history
    const emaTrend = IndicatorService.computeEMA(
      closes_history,
      this._trend_period,
    );
    const rsi = IndicatorService.computeWilderRSI(closes_history, this._rsi_period);

    // 1. Manage Exits
    const remaining: Position[] = [];
    for (const pos of this.positions) {
      let should_exit = false;
      let exit_reason = "";
      let exit_price = current_close;

      // Tiered Exit / SL adjustment
      if (this._move_sl_to_be_at_pct > 0) {
        const pnl_pct =
          ((current_close - pos.entry_price) / pos.entry_price) * 100;
        if (pnl_pct >= this._move_sl_to_be_at_pct) {
          if (pos.stop_loss_price < pos.entry_price) {
            pos.stop_loss_price = pos.entry_price;
          }
          // Partial Exit (TP1) if not already hit
          if (!(pos.meta as any)?.tp1_hit) {
            const qty_to_sell = pos.quantity * 0.5;
            this._market_sell(pos, current_close, "tp1_exit", timestamp, qty_to_sell);
            if (pos.meta) (pos.meta as any).tp1_hit = true;
          }
        }
      }

      if (this._ts_pct > 0) {
        const new_ts_price = current_close * (1 - this._ts_pct / 100);
        if (new_ts_price > pos.stop_loss_price) {
          pos.stop_loss_price = new_ts_price;
        }
      }

      // Trailing Exit (EMA 9) after TP1
      const ema9 = IndicatorService.computeEMA(closes_history, 9);
      if ((pos.meta as any)?.tp1_hit && current_close < ema9) {
          should_exit = true;
          exit_reason = "ema_trailing_exit";
          exit_price = current_close;
      }

      if (low <= pos.stop_loss_price) {
        should_exit = true;
        exit_reason = "SL";
        exit_price = pos.stop_loss_price;
      } else if (high >= pos.take_profit_price) {
        should_exit = true;
        exit_reason = "TP";
        exit_price = pos.take_profit_price;
      } else if (this._exit_on_trend_reversal && current_close < emaTrend) {
        should_exit = true;
        exit_reason = "TREND";
        exit_price = current_close;
      }

      if (should_exit) {
        this._market_sell(pos, exit_price, exit_reason, timestamp);
        this._last_trade_candle = this._candle_counter;
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;

    // 2. Entry Logic
    if (
      this.positions.length === 0 &&
      this._last_trade_candle !== this._candle_counter
    ) {
      const trend_up = current_close > emaTrend;
      const oversold = rsi < this._rsi_threshold;

      if (trend_up && oversold) {
        this._market_buy(current_close, timestamp);
        this._last_trade_candle = this._candle_counter;
      }
    }

    const equity =
      this.balance +
      this.positions.reduce((s, p) => s + p.quantity * current_close, 0);
    if (equity > this._peak_equity) this._peak_equity = equity;
    this.equity_curve.push(equity);

    const current_sl =
      this.positions.length > 0 ? this.positions[0].stop_loss_price : null;
    this.sl_curve.push(current_sl);
  }

  private _market_buy(price: number, timestamp: number): void {
    const trade_allocation =
      this.initial_balance * (this._max_exposure_pct / 100);
    const spendable = Math.min(this.balance, trade_allocation) * 0.99;
    const qty = spendable / price;
    const cost = qty * price;
    const fee = (cost * this.fee_pct) / 100;

    if (qty <= 0 || cost + fee > this.balance) return;

    this.balance -= cost + fee;
    const sl = price * (1 - this._sl_pct / 100);
    const tp = price * (1 + this._tp_pct / 100);

    const pos = new Position(price, qty, tp, sl, 0);
    pos.meta = { opened_at_candle: this._candle_counter };
    this.positions.push(pos);
    this.trade_log.push({
      timestamp,
      side: "buy",
      price,
      quantity: qty,
      reason: "ENTRY",
      stop_loss: sl,
      take_profit: tp,
    });
  }

  private _market_sell(
    pos: Position,
    price: number,
    reason: string,
    timestamp: number,
    split_qty: number | null = null,
  ): void {
    const qty_to_sell =
      split_qty !== null ? Math.min(pos.quantity, split_qty) : pos.quantity;
    const proceeds = price * qty_to_sell;
    const fee = (proceeds * this.fee_pct) / 100;
    this.balance += proceeds - fee;
    const cost = pos.entry_price * qty_to_sell;
    const pnl = proceeds - fee - (cost + (cost * this.fee_pct) / 100);
    this.trade_log.push({
      timestamp,
      side: "sell",
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

  public close_all_positions(price: number, timestamp: number): void {
    for (const pos of this.positions) {
      this._market_sell(pos, price, "END_OF_DATA", timestamp);
    }
    this.positions = [];
    const equity = this.balance;
    if (equity > this._peak_equity) this._peak_equity = equity;
    this.equity_curve[this.equity_curve.length - 1] = equity;
    this.sl_curve[this.sl_curve.length - 1] = null;
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
    const sell_trades = this.trade_log.filter((t) => t.side === "sell");
    const wins = sell_trades.filter((t) => (t.pnl ?? 0) > 0).length;
    return {
      period: `${new Date(this._start_timestamp ?? 0).toLocaleDateString()} to ${new Date(this._end_timestamp ?? 0).toLocaleDateString()}`,
      duration: `${Math.ceil(((this._end_timestamp ?? 0) - (this._start_timestamp ?? 0)) / 86400000)} days`,
      initial_balance: `${this.initial_balance.toFixed(2)} $`,
      final_value: `${final_equity.toFixed(2)} $`,
      total_profit: `${profit.toFixed(2)} $`,
      roi_pct: `${roi.toFixed(2)} %`,
      total_trades: sell_trades.length,
      max_drawdown_pct: `${(max_dd * 100).toFixed(2)} %`,
      win_rate: `${sell_trades.length > 0 ? ((wins / sell_trades.length) * 100).toFixed(2) : "0"} %`,
    };
  }

  public get_config(): BotConfig {
    return {
      symbol: this.symbol,
      initial_balance: this.initial_balance,
      trend_period: this._trend_period,
      rsi_threshold: this._rsi_threshold,
      rsi_period: this._rsi_period,
      take_profit_pct: this._tp_pct,
      stop_loss_pct: this._sl_pct,
      trailing_stop_pct: this._ts_pct,
      max_exposure_pct: this._max_exposure_pct,
      move_sl_to_be_at_pct: this._move_sl_to_be_at_pct,
      exit_on_trend_reversal: this._exit_on_trend_reversal,
    };
  }

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
      last_processed_candle: this._end_timestamp,
    });
  }

  public static fromJSON(json: string, config: BotConfig): MomentumBot {
    const data = JSON.parse(json);
    const bot = new MomentumBot(config);
    bot.balance = data.balance;
    bot.positions = data.positions.map((p: Record<string, any>) => {
      const pos = new Position(
        p.entry_price,
        p.quantity,
        p.take_profit_price,
        p.stop_loss_price,
        p.trail_distance,
      );
      pos.meta = p.meta;
      return pos;
    });
    bot.equity_curve = data.equity_curve;
    bot.trade_log = data.trade_log;
    bot.set_internal_state(data);
    return bot;
  }

  private set_internal_state(data: Record<string, any>): void {
    this._peak_equity = data.peak_equity;
    this._candle_counter = data.candle_counter;
    this._start_timestamp = data.start_timestamp;
    this._end_timestamp = data.end_timestamp;
  }
}
