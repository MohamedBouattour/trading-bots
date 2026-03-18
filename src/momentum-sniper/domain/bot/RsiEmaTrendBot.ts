import { BaseStrategyBot } from "./StrategyBots";
import { BotConfig } from "../../../models/BotConfig";
import { RsiEmaTrendStrategy, OHLCV } from "../strategies/RsiEmaTrendStrategy";

/**
 * Bot implementing the Optimized RSI + 100 EMA Trend Follower Strategy.
 */
export class RsiEmaTrendBot extends BaseStrategyBot {
  private _strategy: RsiEmaTrendStrategy;
  private _ohlcvHistory: OHLCV[] = [];

  constructor(config: BotConfig) {
    super(config);
    this._strategy = new RsiEmaTrendStrategy();
  }

  public on_candle(
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number,
    _volume: number,
    _closes_history: number[],
    _volumes_history: number[] = [],
    _highs_history: number[] = [],
    _lows_history: number[] = [],
  ): void {
    this._candle_counter++;
    if (this._start_timestamp === null) this._start_timestamp = timestamp;
    this._end_timestamp = timestamp;

    // Build OHLCV history for the strategy
    const currentOHLCV: OHLCV = {
      timestamp,
      open,
      high,
      low,
      close,
      volume: _volume,
    };
    this._ohlcvHistory.push(currentOHLCV);

    // Keep history manageable
    if (this._ohlcvHistory.length > 200) {
      this._ohlcvHistory.shift();
    }

    // 1. Manage existing positions
    const pos_copy = [...this.positions];
    for (const pos of pos_copy) {
      let exit_price = 0;
      let exit_reason = "";

      if (pos.side === "LONG") {
        if (low <= pos.stop_loss_price) {
          exit_price = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (high >= pos.take_profit_price) {
          exit_price = pos.take_profit_price;
          exit_reason = "TP";
        }
      } else {
        // SHORT
        if (high >= pos.stop_loss_price) {
          exit_price = pos.stop_loss_price;
          exit_reason = "SL";
        } else if (low <= pos.take_profit_price) {
          exit_price = pos.take_profit_price;
          exit_reason = "TP";
        }
      }

      if (exit_reason) {
        this._market_sell(pos, exit_price, exit_reason, timestamp);
      }
    }

    // 2. Entry Logic
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
      symbol: this.symbol,
      initial_balance: this.initial_balance,
      // Strategy parameters could be exposed here too if needed
    };
  }
}
