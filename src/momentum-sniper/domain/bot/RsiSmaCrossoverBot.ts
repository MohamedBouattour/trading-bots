import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";
import { IBot, BotSummary } from "./IBot";

export class RsiSmaCrossoverBot implements IBot {
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
  private _rsi_sma_period: number;
  private _rsi_under_sma_duration: number;
  private _move_sl_to_be_at_pct: number;
  private _exit_on_trend_reversal: boolean;

  // Optimal: RSI OB/OS confirmation filter
  private _rsi_ob_os_lookback: number;   // default 5 candles
  private _rsi_long_os_level: number;    // RSI < 40 for LONG
  private _rsi_short_ob_level: number;   // RSI > 60 for SHORT

  private _rsi_history: number[] = [];
  private _rsi_under_sma_counter: number = 0;
  private _rsi_above_sma_counter: number = 0;

  constructor(config: BotConfig) {
    if (!config.symbol) throw new Error("BotConfig: symbol is required");
    if (config.initial_balance === undefined)
      throw new Error("BotConfig: initial_balance is required");

    this.symbol = config.symbol;
    this.initial_balance = config.initial_balance;
    this.balance = this.initial_balance;
    this.fee_pct = config.fee_pct ?? 0.1;

    // Optimal defaults from backtest report (RSI 7, SL 1.5%, TP 6%, EMA 100)
    this._tp_pct = config.take_profit_pct ?? 6.0;
    this._sl_pct = config.stop_loss_pct ?? 1.5;
    this._ts_pct = config.trailing_stop_pct ?? 0.0;
    this._max_exposure_pct = config.max_exposure_pct ?? 100.0;
    this._trend_period = config.trend_period ?? 100;
    this._rsi_period = config.rsi_period ?? 7;
    this._rsi_threshold = config.rsi_threshold ?? 45;
    this._rsi_sma_period = config.rsi_sma_period ?? 14;
    this._rsi_under_sma_duration = config.rsi_under_sma_duration ?? 5;
    this._move_sl_to_be_at_pct = config.move_sl_to_be_at_pct ?? 0.0;
    this._exit_on_trend_reversal = !!config.exit_on_trend_reversal;

    // RSI OB/OS filter params (optimal config from report)
    this._rsi_ob_os_lookback = (config as any).rsi_ob_os_lookback ?? 5;
    this._rsi_long_os_level = (config as any).rsi_long_os_level ?? 40;
    this._rsi_short_ob_level = (config as any).rsi_short_ob_level ?? 60;

    this.equity_curve = [this.initial_balance];
    this._peak_equity = this.initial_balance;
  }

  public on_candle(
    timestamp: number,
    _open: number,
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

    const warmup_period = Math.max(
      this._trend_period,
      this._rsi_period * 2,
      this._rsi_sma_period * 2,
    );
    if (closes_history.length < warmup_period) return;

    const emaTrend = IndicatorService.computeEMA(closes_history, this._trend_period);
    const rsi = IndicatorService.computeRSI(closes_history, this._rsi_period);

    this._rsi_history.push(rsi);
    if (this._rsi_history.length > this._rsi_sma_period * 2) {
      this._rsi_history.shift();
    }
    const rsi_sma = IndicatorService.computeSMA(this._rsi_history, this._rsi_sma_period);

    // ── 1. Manage Exits ─────────────────────────────────────────────────────
    const remaining: Position[] = [];
    for (const pos of this.positions) {
      let should_exit = false;
      let exit_reason = "";
      let exit_price = close;

      if (pos.side === "LONG") {
        // Move SL to break-even
        if (this._move_sl_to_be_at_pct > 0) {
          const pnl_pct = ((close - pos.entry_price) / pos.entry_price) * 100;
          if (pnl_pct >= this._move_sl_to_be_at_pct && pos.stop_loss_price < pos.entry_price) {
            pos.stop_loss_price = pos.entry_price;
          }
        }
        // Trailing Stop
        if (this._ts_pct > 0) {
          const new_ts = close * (1 - this._ts_pct / 100);
          if (new_ts > pos.stop_loss_price) pos.stop_loss_price = new_ts;
        }
        if (low <= pos.stop_loss_price) {
          should_exit = true; exit_reason = "SL"; exit_price = pos.stop_loss_price;
        } else if (high >= pos.take_profit_price) {
          should_exit = true; exit_reason = "TP"; exit_price = pos.take_profit_price;
        } else if (this._exit_on_trend_reversal && close < emaTrend) {
          should_exit = true; exit_reason = "TREND"; exit_price = close;
        }
      } else {
        // SHORT position
        // Move SL to break-even for short
        if (this._move_sl_to_be_at_pct > 0) {
          const pnl_pct = ((pos.entry_price - close) / pos.entry_price) * 100;
          if (pnl_pct >= this._move_sl_to_be_at_pct && pos.stop_loss_price > pos.entry_price) {
            pos.stop_loss_price = pos.entry_price;
          }
        }
        // Trailing Stop for short
        if (this._ts_pct > 0) {
          const new_ts = close * (1 + this._ts_pct / 100);
          if (new_ts < pos.stop_loss_price) pos.stop_loss_price = new_ts;
        }
        if (high >= pos.stop_loss_price) {
          should_exit = true; exit_reason = "SL"; exit_price = pos.stop_loss_price;
        } else if (low <= pos.take_profit_price) {
          should_exit = true; exit_reason = "TP"; exit_price = pos.take_profit_price;
        } else if (this._exit_on_trend_reversal && close > emaTrend) {
          should_exit = true; exit_reason = "TREND"; exit_price = close;
        }
      }

      if (should_exit) {
        this._close_position(pos, exit_price, exit_reason, timestamp);
        this._last_trade_candle = this._candle_counter;
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;

    // ── 2. Entry Logic ──────────────────────────────────────────────────────
    if (this.positions.length === 0 && this._last_trade_candle !== this._candle_counter) {
      const prev_rsi = this._rsi_history.length >= 2
        ? this._rsi_history[this._rsi_history.length - 2]
        : rsi;
      const prev_rsi_history = this._rsi_history.slice(0, -1);
      const prev_rsi_sma = prev_rsi_history.length > 0
        ? IndicatorService.computeSMA(prev_rsi_history, this._rsi_sma_period)
        : rsi_sma;

      const crossed_above = prev_rsi < prev_rsi_sma && rsi > rsi_sma;
      const crossed_below = prev_rsi > prev_rsi_sma && rsi < rsi_sma;

      // RSI OB/OS filter: check last N candles of rsi_history
      const lookback = this._rsi_history.slice(-this._rsi_ob_os_lookback);
      const was_oversold = lookback.some((r) => r < this._rsi_long_os_level);
      const was_overbought = lookback.some((r) => r > this._rsi_short_ob_level);

      // LONG: RSI crosses above SMA + close above EMA100 + was oversold in last 5 candles
      const long_signal =
        crossed_above &&
        close > emaTrend &&
        was_oversold &&
        this._rsi_under_sma_counter >= this._rsi_under_sma_duration;

      // SHORT: RSI crosses below SMA + close below EMA100 + was overbought in last 5 candles
      const short_signal =
        crossed_below &&
        close < emaTrend &&
        was_overbought &&
        this._rsi_above_sma_counter >= this._rsi_under_sma_duration;

      if (long_signal) {
        this._open_long(close, timestamp);
        this._last_trade_candle = this._candle_counter;
      } else if (short_signal) {
        this._open_short(close, timestamp);
        this._last_trade_candle = this._candle_counter;
      }
    }

    // Update RSI crossover counters
    if (rsi < rsi_sma) {
      this._rsi_under_sma_counter++;
      this._rsi_above_sma_counter = 0;
    } else {
      this._rsi_above_sma_counter++;
      this._rsi_under_sma_counter = 0;
    }

    // Update equity (unrealised PnL for open positions)
    const equity =
      this.balance +
      this.positions.reduce((s, p) => {
        const unrealised =
          p.side === "LONG"
            ? (close - p.entry_price) * p.quantity
            : (p.entry_price - close) * p.quantity;
        return s + p.entry_price * p.quantity + unrealised;
      }, 0);
    if (equity > this._peak_equity) this._peak_equity = equity;
    this.equity_curve.push(equity);

    const current_sl = this.positions.length > 0 ? this.positions[0].stop_loss_price : null;
    this.sl_curve.push(current_sl);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _open_long(price: number, timestamp: number): void {
    const trade_allocation = this.initial_balance * (this._max_exposure_pct / 100);
    const spendable = Math.min(this.balance, trade_allocation) * 0.99;
    const qty = spendable / price;
    const cost = qty * price;
    const fee = (cost * this.fee_pct) / 100;
    if (qty <= 0 || cost + fee > this.balance) return;

    this.balance -= cost + fee;
    const sl = price * (1 - this._sl_pct / 100);
    const tp = price * (1 + this._tp_pct / 100);
    const pos = new Position(price, qty, tp, sl, 0, "LONG");
    pos.meta = { opened_at_candle: this._candle_counter };
    this.positions.push(pos);
    this.trade_log.push({ timestamp, side: "buy", price, quantity: qty, reason: "LONG_ENTRY", stop_loss: sl, take_profit: tp });
  }

  private _open_short(price: number, timestamp: number): void {
    const trade_allocation = this.initial_balance * (this._max_exposure_pct / 100);
    const spendable = Math.min(this.balance, trade_allocation) * 0.99;
    const qty = spendable / price;
    const cost = qty * price;
    const fee = (cost * this.fee_pct) / 100;
    if (qty <= 0 || cost + fee > this.balance) return;

    this.balance -= cost + fee;
    const sl = price * (1 + this._sl_pct / 100);  // SL above entry for SHORT
    const tp = price * (1 - this._tp_pct / 100);  // TP below entry for SHORT
    const pos = new Position(price, qty, tp, sl, 0, "SHORT");
    pos.meta = { opened_at_candle: this._candle_counter };
    this.positions.push(pos);
    // Entry logged as "sell" (opening short)
    this.trade_log.push({ timestamp, side: "sell", price, quantity: qty, reason: "SHORT_ENTRY", stop_loss: sl, take_profit: tp });
  }

  private _close_position(pos: Position, price: number, reason: string, timestamp: number): void {
    const qty = pos.quantity;
    const entry_cost = pos.entry_price * qty;
    const fee_entry = (entry_cost * this.fee_pct) / 100;
    const proceeds = price * qty;
    const fee_exit = (proceeds * this.fee_pct) / 100;

    let pnl: number;
    if (pos.side === "LONG") {
      pnl = proceeds - fee_exit - entry_cost - fee_entry;
      this.balance += entry_cost + pnl;
      this.trade_log.push({ timestamp, side: "sell", price, quantity: qty, reason, pnl, stop_loss: pos.stop_loss_price, take_profit: pos.take_profit_price });
    } else {
      // SHORT: profit when price fell
      pnl = entry_cost - proceeds - fee_exit - fee_entry;
      this.balance += entry_cost + pnl;
      // Exit logged as "buy" (closing short)
      this.trade_log.push({ timestamp, side: "buy", price, quantity: qty, reason, pnl, stop_loss: pos.stop_loss_price, take_profit: pos.take_profit_price });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  public close_all_positions(price: number, timestamp: number): void {
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      this._close_position(pos, price, "END_OF_DATA", timestamp);
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

    // Fix: use pnl !== undefined to identify closing trades only.
    // Correctly handles LONG exits (side=sell) and SHORT exits (side=buy).
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

  public get_config(): BotConfig {
    return {
      symbol: this.symbol,
      initial_balance: this.initial_balance,
      trend_period: this._trend_period,
      rsi_threshold: this._rsi_threshold,
      rsi_period: this._rsi_period,
      rsi_sma_period: this._rsi_sma_period,
      rsi_under_sma_duration: this._rsi_under_sma_duration,
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
      rsi_history: this._rsi_history,
      rsi_under_sma_counter: this._rsi_under_sma_counter,
      rsi_above_sma_counter: this._rsi_above_sma_counter,
    });
  }

  public static fromJSON(json: string, config: BotConfig): RsiSmaCrossoverBot {
    const data = JSON.parse(json);
    const bot = new RsiSmaCrossoverBot(config);
    bot.balance = data.balance;
    bot.positions = data.positions.map((p: Record<string, any>) => {
      const pos = new Position(
        p.entry_price,
        p.quantity,
        p.take_profit_price,
        p.stop_loss_price,
        p.trail_distance,
        p.side ?? "LONG",
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
    if (data.rsi_history) this._rsi_history = data.rsi_history;
    if (data.rsi_under_sma_counter !== undefined)
      this._rsi_under_sma_counter = data.rsi_under_sma_counter;
    if (data.rsi_above_sma_counter !== undefined)
      this._rsi_above_sma_counter = data.rsi_above_sma_counter;
  }
}
