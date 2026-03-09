import { Order } from "../../../models/Order";
import { Position } from "../../../models/Position";
import { Trade } from "../../../models/Trade";
import { BotConfig } from "../../../models/BotConfig";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

export interface BotSummary {
  period: string;
  duration: string;
  initial_balance: string;
  final_value: string;
  total_profit: string;
  roi_pct: string;
  total_trades: number;
  max_drawdown_pct: string;
  win_rate: string;
}

export class MomentumBot {
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

  // Strategy Params
  private _tp_pct: number;
  private _sl_pct: number;
  private _ts_pct: number;
  private _max_exposure_pct: number;
  private _trend_period: number;
  private _rsi_period: number = 14;
  private _rsi_threshold: number = 30;
  private _move_sl_to_be_at_pct: number;

  constructor(config: BotConfig = {}) {
    this.symbol = config.symbol ?? "SOL/USDT";
    this.initial_balance = config.initial_balance ?? 1000.0;
    this.balance = this.initial_balance;
    this.fee_pct = config.fee_pct ?? 0.1;

    this._tp_pct = config.take_profit_pct ?? 10.0;
    this._sl_pct = config.stop_loss_pct ?? 3.0;
    this._ts_pct = config.trailing_stop_pct ?? 0.0;
    this._max_exposure_pct = config.max_exposure_pct ?? 10.0;
    this._trend_period = config.trend_period ?? 200;
    this._rsi_period = config.rsi_period ?? 14;
    this._rsi_threshold = config.rsi_threshold ?? 30;
    this._move_sl_to_be_at_pct = config.move_sl_to_be_at_pct ?? 0.0;

    this.equity_curve = [this.initial_balance];
    this._peak_equity = this.initial_balance;
  }

  public on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    closes_history: number[],
    volumes_history: number[] = [],
    highs_history: number[] = [],
    lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    if (closes_history.length < this._trend_period) return; 

    const current_close = closes_history[closes_history.length - 1];
    const ema200 = IndicatorService.computeEMA(closes_history, this._trend_period);
    const rsi = IndicatorService.computeRSI(closes_history, this._rsi_period);

    // 1. Manage Exits
    const remaining: Position[] = [];
    for (const pos of this.positions) {
      let should_exit = false;
      let exit_reason = "";

      // Move SL to Break-Even if price hits threshold
      if (this._move_sl_to_be_at_pct > 0) {
        const pnl_pct = ((current_close - pos.entry_price) / pos.entry_price) * 100;
        if (pnl_pct >= this._move_sl_to_be_at_pct) {
          if (pos.stop_loss_price < pos.entry_price) {
            pos.stop_loss_price = pos.entry_price;
          }
        }
      }

      // Trailing Stop logic
      if (this._ts_pct > 0) {
          const new_ts_price = current_close * (1 - this._ts_pct / 100);
          if (new_ts_price > pos.stop_loss_price) {
              pos.stop_loss_price = new_ts_price;
          }
      }

      if (low <= pos.stop_loss_price) { should_exit = true; exit_reason = "SL"; }
      else if (high >= pos.take_profit_price) { should_exit = true; exit_reason = "TP"; }

      if (should_exit) {
        const exitPrice = (exit_reason === "SL") ? pos.stop_loss_price : pos.take_profit_price;
        this._market_sell(pos, exitPrice, exit_reason, timestamp);
      } else {
        remaining.push(pos);
      }
    }
    this.positions = remaining;

    // 2. Entry Logic (EMA 200 Filter + RSI Pullback)
    if (this.positions.length === 0) {
      const trend_up = current_close > ema200;
      const oversold = rsi < this._rsi_threshold;

      if (trend_up && oversold) {
        this._market_buy(current_close, timestamp);
      }
    }

    const equity = this.balance + this.positions.reduce((s, p) => s + (p.quantity * current_close), 0);
    if (equity > this._peak_equity) this._peak_equity = equity;
    this.equity_curve.push(equity);

    const current_sl = this.positions.length > 0 ? this.positions[0].stop_loss_price : null;
    this.sl_curve.push(current_sl);
  }

  private _market_buy(price: number, timestamp: number): void {
    const trade_allocation = this.initial_balance * (this._max_exposure_pct / 100);
    const spendable = Math.min(this.balance, trade_allocation) * 0.99; // leave room for fees
    const qty = spendable / price; 
    const cost = qty * price;
    const fee = (cost * this.fee_pct) / 100;
    
    if (qty <= 0 || cost + fee > this.balance) return;

    this.balance -= (cost + fee);
    const sl = price * (1 - this._sl_pct / 100);
    const tp = price * (1 + this._tp_pct / 100);
    
    const pos = new Position(price, qty, tp, sl, 0);
    pos.meta = { opened_at_candle: this._candle_counter };
    this.positions.push(pos);
    this.trade_log.push({ timestamp, side: "buy", price, quantity: qty, reason: "ENTRY", stop_loss: sl, take_profit: tp });
  }

  private _market_sell(pos: Position, price: number, reason: string, timestamp: number): void {
    const proceeds = price * pos.quantity;
    const fee = (proceeds * this.fee_pct) / 100;
    this.balance += (proceeds - fee);
    const cost = pos.entry_price * pos.quantity;
    const pnl = (proceeds - fee) - (cost + (cost * this.fee_pct / 100));
    this.trade_log.push({ timestamp, side: "sell", price, quantity: pos.quantity, reason, pnl, stop_loss: pos.stop_loss_price, take_profit: pos.take_profit_price });
  }

  public summary(): BotSummary {
    const final_equity = this.equity_curve[this.equity_curve.length - 1];
    const profit = final_equity - this.initial_balance;
    const roi = (profit / this.initial_balance) * 100;
    let max_dd = 0; let peak = this.equity_curve[0];
    for (const eq of this.equity_curve) { if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > max_dd) max_dd = dd; }
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
        trend_period: this._trend_period,
        rsi_threshold: this._rsi_threshold,
        rsi_period: this._rsi_period,
        take_profit_pct: this._tp_pct,
        stop_loss_pct: this._sl_pct,
        trailing_stop_pct: this._ts_pct,
        max_exposure_pct: this._max_exposure_pct
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
        last_processed_candle: this._end_timestamp
    });
  }

  public static fromJSON(json: string, config: BotConfig): MomentumBot {
    const data = JSON.parse(json);
    const bot = new MomentumBot(config);
    bot.balance = data.balance;
    bot.positions = data.positions.map((p: any) => {
        const pos = new Position(p.entry_price, p.quantity, p.take_profit_price, p.stop_loss_price, p.trail_distance);
        pos.meta = p.meta;
        return pos;
    });
    bot.equity_curve = data.equity_curve;
    bot.trade_log = data.trade_log;
    bot.set_internal_state(data);
    return bot;
  }

  private set_internal_state(data: any): void {
      this._peak_equity = data.peak_equity;
      this._candle_counter = data.candle_counter;
      this._start_timestamp = data.start_timestamp;
      this._end_timestamp = data.end_timestamp;
  }
}
