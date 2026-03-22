import { BaseStrategyBot } from "./StrategyBots";
import { BotConfig } from "../../../models/BotConfig";
import { RsiEmaTrendStrategy, OHLCV } from "../strategies/RsiEmaTrendStrategy";
import { IndicatorService } from "../../../shared/indicators/IndicatorService";

/**
 * Bot implementing the Optimized RSI + EMA Trend Follower Strategy.
 * All tunable parameters are read from BotConfig (and thus from .env),
 * so the .env values for RSI_PERIOD, RSI_SMA_PERIOD, TREND_PERIOD,
 * TAKE_PROFIT, and STOP_LOSS are actually honoured at runtime.
 */
export class RsiEmaTrendBot extends BaseStrategyBot {
  private _strategy: RsiEmaTrendStrategy;
  private _ohlcvHistory: OHLCV[] = [];
  private readonly _historyLimit: number;
  private readonly _max_exposure: number;
  private readonly _max_dd_exit: number;
  private readonly _move_sl_to_be: number;
  private readonly _exit_on_reversal: boolean;
  private readonly _trailing_stop: number;

  constructor(config: BotConfig) {
    super(config);

    this._max_exposure = config.max_exposure ?? 100;
    this._max_dd_exit = config.max_dd_exit ?? 0;
    this._move_sl_to_be = config.move_sl_to_be_at_pct ?? 0;
    this._exit_on_reversal = config.exit_on_trend_reversal ?? false;
    this._trailing_stop = config.trailing_stop ?? 0;

    // Wire BotConfig → RsiEmaTrendStrategy so .env values are respected.
    this._strategy = new RsiEmaTrendStrategy({
      emaPeriod: config.trend_period ?? 100,
      rsiPeriod: config.rsi_period ?? 7,
      rsiSmaPeriod: config.rsi_sma_period ?? 7,
      oversoldThreshold: config.rsi_long_os_level ?? 40,
      overboughtThreshold: config.rsi_short_ob_level ?? 60,
      confirmationLookback: config.rsi_ob_os_lookback ?? 5,
      slPct: config.stop_loss_pct ?? 1.5,
      tpPct: config.take_profit_pct ?? 6.0,
    });

    // Keep a window large enough for EMA warmup + RSI SMA + lookback buffer
    this._historyLimit = Math.max((config.trend_period ?? 100) * 2 + 50, 300);
  }

  public on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    _closes_history: number[],
    _volumes_history: number[] = [],
    _highs_history: number[] = [],
    _lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    // NOTE: This bot maintains its own OHLCV history because RsiEmaTrendStrategy
    // requires full OHLCV candles, not just closes. The closes_history parameter
    // from the backtest runner is not used. The _historyLimit ensures enough data
    // for EMA warmup (trend_period * 2 + 50 = 250 candles for EMA-100).
    this._ohlcvHistory.push({ timestamp, open, high, low, close, volume });
    if (this._ohlcvHistory.length > this._historyLimit) {
      this._ohlcvHistory.shift();
    }

    if (this.halted_by_dd) {
      this._update_equity(close);
      return;
    }

    if (this._max_dd_exit > 0) {
      const current_equity = this._calculate_equity(close);
      const dd_pct =
        ((this._peak_equity - current_equity) / this._peak_equity) * 100;
      if (dd_pct >= this._max_dd_exit) {
        if (this.positions.length > 0) {
          this.close_all_positions(close, timestamp);
        }
        this.halted_by_dd = true;
        this._update_equity(close);
        return;
      }
    }

    // ── 1. Manage existing positions ──────────────────────────────────────
    const pos_copy = [...this.positions];
    let emaVal = 0;
    if (this._exit_on_reversal) {
      const closes = this._ohlcvHistory.map((c) => c.close);
      emaVal = IndicatorService.computeEMA(
        closes,
        (this._strategy as any).EMA_PERIOD,
      );
    }

    for (const pos of pos_copy) {
      const posOpenedAt = (pos.meta as any)?.opened_at_candle;
      if (posOpenedAt === this._candle_counter) {
        // Skip SL/TP check on the same candle it was opened to prevent lookahead logic bias
        continue;
      }

      let exit_price = 0;
      let exit_reason = "";

      if (pos.side === "LONG") {
        if (low <= pos.stop_loss_price) {
          exit_price = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (high >= pos.take_profit_price) {
          exit_price = pos.take_profit_price;
          exit_reason = "TP";
        } else if (this._exit_on_reversal && close < emaVal) {
          exit_price = close;
          exit_reason = "REVERSAL";
        }
      } else {
        // SHORT
        if (high >= pos.stop_loss_price) {
          exit_price = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (low <= pos.take_profit_price) {
          exit_price = pos.take_profit_price;
          exit_reason = "TP";
        } else if (this._exit_on_reversal && close > emaVal) {
          exit_price = close;
          exit_reason = "REVERSAL";
        }
      }

      if (exit_reason) {
        this._market_sell(pos, exit_price, exit_reason, timestamp);
        this._last_trade_candle = this._candle_counter;
      } else {
        // Update SL (Trailing and/or BE) if not exited
        if (pos.side === "LONG") {
          // Break-even
          if (this._move_sl_to_be > 0) {
            const moveInFavor =
              ((high - pos.entry_price) / pos.entry_price) * 100;
            if (
              moveInFavor >= this._move_sl_to_be &&
              pos.stop_loss_price < pos.entry_price
            ) {
              pos.stop_loss_price = pos.entry_price;
            }
          }
          // Trailing stop
          if (this._trailing_stop > 0) {
            const trail_sl = high * (1 - this._trailing_stop / 100);
            if (trail_sl > pos.stop_loss_price) {
              pos.stop_loss_price = trail_sl;
            }
          }
        } else {
          // SHORT
          if (this._move_sl_to_be > 0) {
            const moveInFavor =
              ((pos.entry_price - low) / pos.entry_price) * 100;
            if (
              moveInFavor >= this._move_sl_to_be &&
              pos.stop_loss_price > pos.entry_price
            ) {
              pos.stop_loss_price = pos.entry_price;
            }
          }
          if (this._trailing_stop > 0) {
            const trail_sl = low * (1 + this._trailing_stop / 100);
            if (trail_sl < pos.stop_loss_price || pos.stop_loss_price === 0) {
              pos.stop_loss_price = trail_sl;
            }
          }
        }
      }
    }

    // ── 2. Entry Logic ────────────────────────────────────────────────────
    if (
      this.positions.length === 0 &&
      this._last_trade_candle !== this._candle_counter
    ) {
      const signalData = this._strategy.checkSignal(this._ohlcvHistory);

      if (signalData.signal === "LONG") {
        this._open_position(
          "LONG",
          signalData.entryPrice,
          timestamp,
          signalData.stopLossPrice,
          signalData.takeProfitPrice,
          this._max_exposure,
          "RSI_EMA_LONG",
        );
        this._last_trade_candle = this._candle_counter;
      } else if (signalData.signal === "SHORT") {
        this._open_position(
          "SHORT",
          signalData.entryPrice,
          timestamp,
          signalData.stopLossPrice,
          signalData.takeProfitPrice,
          this._max_exposure,
          "RSI_EMA_SHORT",
        );
        this._last_trade_candle = this._candle_counter;
      }
    }

    this._update_equity(close);
  }

  public get_config(): BotConfig {
    return {
      symbol: this.symbol,
      initial_balance: this.initial_balance,
      fee_pct: this.fee_pct,
      trend_period: (this._strategy as any).EMA_PERIOD,
      rsi_period: (this._strategy as any).RSI_PERIOD,
      rsi_sma_period: (this._strategy as any).RSI_SMA_PERIOD,
      stop_loss_pct: (this._strategy as any).SL_PCT,
      take_profit_pct: (this._strategy as any).TP_PCT,
    };
  }

  public static fromJSON(jsonStr: string, config: BotConfig): RsiEmaTrendBot {
    const raw = JSON.parse(jsonStr);
    const bot = new RsiEmaTrendBot(config);
    (bot as any).symbol = raw.symbol;
    (bot as any).initial_balance = raw.initial_balance;
    bot.balance = raw.balance;
    bot.positions = raw.positions || [];
    bot.equity_curve = raw.equity_curve || [];
    bot.trade_log = raw.trade_log || [];
    (bot as any)._peak_equity = raw.peak_equity || bot.initial_balance;
    (bot as any)._candle_counter = raw.candle_counter || 0;
    (bot as any)._start_timestamp = raw.start_timestamp || null;
    (bot as any)._end_timestamp = raw.end_timestamp || null;
    (bot as any)._ohlcvHistory = raw.ohlcv_history || [];
    return bot;
  }
}
