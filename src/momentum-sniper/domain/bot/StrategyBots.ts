import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";
import { IBot, BotSummary } from "./IBot";

export abstract class BaseStrategyBot implements IBot {
  public readonly symbol: string;
  public readonly initial_balance: number;
  public readonly fee_pct: number;

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

  constructor(config: BotConfig) {
    this.symbol = config.symbol ?? "BTCUSDT";
    this.initial_balance = config.initial_balance ?? 1000.0;
    this.balance = this.initial_balance;
    this.fee_pct = config.fee_pct ?? 0.1;

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

  protected _update_equity(current_close: number): void {
    const equity =
      this.balance +
      this.positions.reduce((s, p) => {
        const pnl =
          p.side === "LONG"
            ? (current_close - p.entry_price) * p.quantity
            : (p.entry_price - current_close) * p.quantity;
        return s + p.entry_price * p.quantity + pnl;
      }, 0);
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
    const trade_allocation = this.initial_balance * (size_pct / 100);
    const spendable = Math.min(this.balance, trade_allocation) * 0.99;
    const qty = spendable / price;
    const cost = qty * price;
    const fee = (cost * this.fee_pct) / 100;

    if (qty <= 0 || cost + fee > this.balance) return;

    this.balance -= cost + fee;
    const pos = new Position(price, qty, tp, sl, 0, side);
    pos.meta = { opened_at_candle: this._candle_counter };
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
    const proceeds_base = price * qty_to_sell;
    const fee = (proceeds_base * this.fee_pct) / 100;

    const entry_cost = pos.entry_price * qty_to_sell;
    const pnl =
      pos.side === "LONG"
        ? proceeds_base - entry_cost - fee - (entry_cost * this.fee_pct) / 100
        : entry_cost - proceeds_base - fee - (entry_cost * this.fee_pct) / 100;

    this.balance += entry_cost + pnl;

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

  public close_all_positions(price: number, timestamp: number): void {
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
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
    });
  }
}

/**
 * Strategy 1: Trend Rider (With SL)
 * BB Breakout + 1.5x Vol Spike
 * SL: 2.5x ATR below Entry
 * TP: Trailing exit on 4H close below 9 EMA
 */
export class TrendRiderBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    closes_history: number[],
    volumes_history: number[] = [],
    highs_history: number[] = [],
    lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const warmup = 20;
    if (closes_history.length < warmup) return;

    // 1. Manage Exits (Trailing EMA 9)
    const ema9 = IndicatorService.computeEMA(closes_history, 9);
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      if (low <= pos.stop_loss_price) {
        this._market_sell(pos, pos.stop_loss_price, "SL", timestamp);
      } else if (close < ema9) {
        this._market_sell(pos, close, "EMA9_EXIT", timestamp);
      }
    }

    // 2. Entry Logic
    if (this.positions.length === 0) {
      const bb = IndicatorService.computeBollingerBands(closes_history, 20, 2);
      const volSma = IndicatorService.computeVolumeSMA(volumes_history, 20);

      const bb_breakout = close > bb.upper;
      const volume_spike = volume > 1.5 * volSma;

      if (bb_breakout && volume_spike) {
        const atr = IndicatorService.computeATR_HL(
          highs_history,
          lows_history,
          closes_history,
          14,
        );
        const sl = close - 2.5 * atr;
        this._market_buy(close, timestamp, sl, 0, 100, "BB_VOL_BREAKOUT");
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}

/**
 * Strategy 2: Fixed Target (With SL)
 * MACD Cross + Price > 50 SMA
 * SL: 8% below Entry
 * TP: 50% at 16%, 50% at 24%
 */
export class FixedTargetBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    high: number,
    low: number,
    close: number,
    _volume: number,
    closes_history: number[],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const warmup = 50;
    if (closes_history.length < warmup) return;

    // 1. Manage Exits
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      if (low <= pos.stop_loss_price) {
        this._market_sell(pos, pos.stop_loss_price, "SL", timestamp);
      } else if (high >= pos.entry_price * 1.24) {
        // Check if we already sold half. In this simple implementation, we can use meta.
        this._market_sell(pos, pos.entry_price * 1.24, "TP2 (24%)", timestamp);
      } else if (
        high >= pos.entry_price * 1.16 &&
        !(pos.meta as any)?.tp1_hit
      ) {
        this._market_sell(
          pos,
          pos.entry_price * 1.16,
          "TP1 (16%)",
          timestamp,
          pos.quantity * 0.5,
        );
        if (pos.meta) (pos.meta as any).tp1_hit = true;
      }
    }

    // 2. Entry Logic
    if (this.positions.length === 0) {
      const ma50 = IndicatorService.computeSMA(closes_history, 50);
      const macd = IndicatorService.computeMACD(closes_history);

      // MACD Cross: histogram was negative, now positive
      // We need previous histogram to detect cross
      const prev_closes = closes_history.slice(0, -1);
      const prev_macd = IndicatorService.computeMACD(prev_closes);

      const macd_cross = prev_macd.histogram <= 0 && macd.histogram > 0;
      const above_sma = close > ma50;

      if (macd_cross && above_sma) {
        const sl = close * 0.92;
        this._market_buy(
          close,
          timestamp,
          sl,
          close * 1.24,
          100,
          "MACD_SMA_ENTRY",
        );
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}

/**
 * Strategy 3: Deep Value (No SL)
 * RSI < 20 + Price < 15% below 50 SMA
 * SL: None (Hold through drawdown)
 * TP: Limit sell order at +45% from average entry
 */
export class DeepValueBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    high: number,
    low: number,
    close: number,
    _volume: number,
    closes_history: number[],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const warmup = 50;
    if (closes_history.length < warmup) return;

    // 1. Manage Exits
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      // TP Only
      if (high >= pos.entry_price * 1.45) {
        this._market_sell(
          pos,
          pos.entry_price * 1.45,
          "DEEP_VAL_TP",
          timestamp,
        );
      }
    }

    // 2. Entry Logic (HODL mode allows multiple entries if we want, but let's stick to 1 for simplicity or full allocation)
    if (this.positions.length === 0) {
      const rsi = IndicatorService.computeRSI(closes_history, 14);
      const sma50 = IndicatorService.computeSMA(closes_history, 50);

      const oversold = rsi < 20;
      const low_price = close < sma50 * 0.85; // 15% below SMA

      if (oversold && low_price) {
        this._market_buy(
          close,
          timestamp,
          0,
          close * 1.45,
          100,
          "DEEP_VALUE_ENTRY",
        );
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}

/**
 * Strategy 4: Pullback Rider
 * Price touches 21 EMA from above (Trend must be UP: 21 EMA > 50 EMA)
 * SL: Dynamic - 4H candle closes below 50 EMA
 * TP Trailing: Chandelier Exit (Highest High - ATR x 3)
 */
export class PullbackRiderBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    _high: number,
    low: number,
    close: number,
    _volume: number,
    closes_history: number[],
    _volumes_history: number[] = [],
    highs_history: number[] = [],
    lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const warmup = 50;
    if (closes_history.length < warmup) return;

    const ema21 = IndicatorService.computeEMA(closes_history, 21);
    const ema50 = IndicatorService.computeEMA(closes_history, 50);
    const atr = IndicatorService.computeATR_HL(
      highs_history,
      lows_history,
      closes_history,
      22,
    );
    const rollingHigh = IndicatorService.computeRollingMax(highs_history, 22);
    const chandelier_sl = rollingHigh - 3 * atr;

    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      // Dynamic SL: Close below 50 EMA
      if (close < ema50) {
        this._market_sell(pos, close, "EMA50_EXIT", timestamp);
      }
      // Trailing TP: Chandelier Exit
      else if (close < chandelier_sl) {
        this._market_sell(pos, close, "CHANDELIER_EXIT", timestamp);
      }
    }

    // Entry Logic
    if (this.positions.length === 0) {
      const trend_up = ema21 > ema50;
      const previous_close = closes_history[closes_history.length - 1];
      const touched_21 = low <= ema21 && previous_close > ema21;

      if (trend_up && touched_21) {
        // Initial SL is at 50 EMA
        this._market_buy(close, timestamp, ema50, 0, 100, "PULLBACK_21EMA");
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}

/**
 * Strategy 5: Volatility Swing
 * RSI < 35 AND Price > 200 SMA
 * SL: Dynamic 2x ATR below entry
 * TP: Scaled 50% at Upper BB, Trail remainder
 */
export class VolatilitySwingBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    high: number,
    low: number,
    close: number,
    _volume: number,
    closes_history: number[],
    _volumes_history: number[] = [],
    highs_history: number[] = [],
    lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    const warmup = 200;
    if (closes_history.length < warmup) return;

    const rsi = IndicatorService.computeRSI(closes_history, 14);
    const sma200 = IndicatorService.computeSMA(closes_history, 200);
    const bb = IndicatorService.computeBollingerBands(closes_history, 20, 2);
    const atr = IndicatorService.computeATR_HL(
      highs_history,
      lows_history,
      closes_history,
      14,
    );

    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      // Stop Loss
      if (low <= pos.stop_loss_price) {
        this._market_sell(pos, pos.stop_loss_price, "SL", timestamp);
      }
      // Take Profit 1: Upper BB
      else if (high >= bb.upper && !(pos.meta as any)?.tp1_hit) {
        this._market_sell(
          pos,
          bb.upper,
          "BB_UPPER_TP1",
          timestamp,
          pos.quantity * 0.5,
        );
        if (pos.meta) (pos.meta as any).tp1_hit = true;
        // Trail remainder: move SL to Entry or ATR trailing
        pos.stop_loss_price = Math.max(pos.stop_loss_price, pos.entry_price);
      }
      // Trail remainder using EMA 9 for exit once TP1 hit
      else if ((pos.meta as any)?.tp1_hit) {
        const ema9 = IndicatorService.computeEMA(closes_history, 9);
        if (close < ema9) {
          this._market_sell(pos, close, "TRAILING_EMA9", timestamp);
        }
      }
    }

    if (this.positions.length === 0) {
      if (rsi < 35 && close > sma200) {
        const sl = close - 2 * atr;
        this._market_buy(close, timestamp, sl, 0, 100, "VOL_SWING_RSI");
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}

/**
 * Strategy 6: Structural Grid
 * Price drops 15% from 14-day rolling high
 * SL: None (Requires appropriate sizing)
 * TP: Hard Limit +20% from entry
 */
export class StructuralGridBot extends BaseStrategyBot {
  on_candle(
    timestamp: number,
    _open: number,
    high: number,
    _low: number,
    close: number,
    _volume: number,
    closes_history: number[],
    _volumes_history: number[] = [],
    highs_history: number[] = [],
    _lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    // 14 days on 4H timeframe = 14 * 6 = 84 candles
    const window = 84;
    if (closes_history.length < window) return;

    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      if (high >= pos.take_profit_price) {
        this._market_sell(pos, pos.take_profit_price, "GRID_TP", timestamp);
      }
    }

    // Entry Logic
    if (this.positions.length < 3) {
      // Allow up to 3 grid levels
      const rollingHigh = IndicatorService.computeRollingMax(
        highs_history,
        window,
      );
      const drop_pct = (rollingHigh - close) / rollingHigh;

      if (drop_pct >= 0.15) {
        // Check if we already have a position nearby to avoid stacking too much at once
        const too_close = this.positions.some(
          (p) => Math.abs(p.entry_price - close) / p.entry_price < 0.05,
        );
        if (!too_close) {
          this._market_buy(
            close,
            timestamp,
            0,
            close * 1.2,
            30,
            "STRUCTURAL_DROP",
          );
        }
      }
    }

    this._update_equity(close);
  }

  get_config(): BotConfig {
    return { symbol: this.symbol, initial_balance: this.initial_balance };
  }
}
