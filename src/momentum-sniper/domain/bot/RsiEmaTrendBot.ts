import { BaseStrategyBot } from "./StrategyBots";
import { BotConfig } from "../../../models/BotConfig";
import { RsiEmaTrendStrategy, OHLCV } from "../strategies/RsiEmaTrendStrategy";

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

  constructor(config: BotConfig) {
    super(config);

    // Wire BotConfig → RsiEmaTrendStrategy so .env values are respected.
    this._strategy = new RsiEmaTrendStrategy({
      emaPeriod:            config.trend_period       ?? 100,
      rsiPeriod:            config.rsi_period         ?? 7,
      rsiSmaPeriod:         config.rsi_sma_period     ?? 7,
      oversoldThreshold:    (config as any).rsi_long_os_level   ?? 40,
      overboughtThreshold:  (config as any).rsi_short_ob_level  ?? 60,
      confirmationLookback: (config as any).rsi_ob_os_lookback  ?? 5,
      slPct:                config.stop_loss_pct      ?? 1.5,
      tpPct:                config.take_profit_pct    ?? 6.0,
    });

    // Keep a window large enough for EMA warmup + RSI SMA + lookback buffer
    this._historyLimit = Math.max((config.trend_period ?? 100) + 50, 200);
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

    this._ohlcvHistory.push({ timestamp, open, high, low, close, volume });
    if (this._ohlcvHistory.length > this._historyLimit) {
      this._ohlcvHistory.shift();
    }

    // ── 1. Manage existing positions ──────────────────────────────────────
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      let exit_price = 0;
      let exit_reason = "";

      if (pos.side === "LONG") {
        if (low <= pos.stop_loss_price) {
          exit_price  = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (high >= pos.take_profit_price) {
          exit_price  = pos.take_profit_price;
          exit_reason = "TP";
        }
      } else {
        // SHORT
        if (high >= pos.stop_loss_price) {
          exit_price  = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (low <= pos.take_profit_price) {
          exit_price  = pos.take_profit_price;
          exit_reason = "TP";
        }
      }

      if (exit_reason) {
        this._market_sell(pos, exit_price, exit_reason, timestamp);
      }
    }

    // ── 2. Entry Logic ────────────────────────────────────────────────────
    if (this.positions.length === 0) {
      const signalData = this._strategy.checkSignal(this._ohlcvHistory);

      if (signalData.signal === "LONG") {
        this._open_position(
          "LONG",
          signalData.entryPrice,
          timestamp,
          signalData.stopLossPrice,
          signalData.takeProfitPrice,
          100,
          "RSI_EMA_LONG",
        );
      } else if (signalData.signal === "SHORT") {
        this._open_position(
          "SHORT",
          signalData.entryPrice,
          timestamp,
          signalData.stopLossPrice,
          signalData.takeProfitPrice,
          100,
          "RSI_EMA_SHORT",
        );
      }
    }

    this._update_equity(close);
  }

  public get_config(): BotConfig {
    return {
      symbol:           this.symbol,
      initial_balance:  this.initial_balance,
      fee_pct:          this.fee_pct,
      trend_period:     (this._strategy as any).EMA_PERIOD,
      rsi_period:       (this._strategy as any).RSI_PERIOD,
      rsi_sma_period:   (this._strategy as any).RSI_SMA_PERIOD,
      stop_loss_pct:    (this._strategy as any).SL_PCT,
      take_profit_pct:  (this._strategy as any).TP_PCT,
    };
  }
}
