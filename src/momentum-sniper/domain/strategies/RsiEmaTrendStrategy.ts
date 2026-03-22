import { IndicatorService } from "../../../shared/indicators/IndicatorService";

export type SignalSide = "LONG" | "SHORT" | "NONE";

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategySignal {
  signal: SignalSide;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}

export interface RsiEmaTrendStrategyConfig {
  emaPeriod?: number; // default 100
  rsiPeriod?: number; // default 7
  rsiSmaPeriod?: number; // default 7
  oversoldThreshold?: number; // default 40
  overboughtThreshold?: number; // default 60
  confirmationLookback?: number; // default 5
  slPct?: number; // default 1.5
  tpPct?: number; // default 6.0
}

/**
 * Optimized RSI + EMA Trend Follower Strategy.
 * All parameters are injectable via constructor so that .env / BotConfig values
 * are respected at runtime instead of being silently ignored.
 */
export class RsiEmaTrendStrategy {
  private readonly EMA_PERIOD: number;
  private readonly RSI_PERIOD: number;
  private readonly RSI_SMA_PERIOD: number;
  private readonly OVERSOLD_THRESHOLD: number;
  private readonly OVERBOUGHT_THRESHOLD: number;
  private readonly CONFIRMATION_LOOKBACK: number;
  private readonly SL_PCT: number;
  private readonly TP_PCT: number;

  constructor(config: RsiEmaTrendStrategyConfig = {}) {
    this.EMA_PERIOD = config.emaPeriod ?? 100;
    this.RSI_PERIOD = config.rsiPeriod ?? 7;
    this.RSI_SMA_PERIOD = config.rsiSmaPeriod ?? 7;
    this.OVERSOLD_THRESHOLD = config.oversoldThreshold ?? 40;
    this.OVERBOUGHT_THRESHOLD = config.overboughtThreshold ?? 60;
    this.CONFIRMATION_LOOKBACK = config.confirmationLookback ?? 5;
    this.SL_PCT = config.slPct ?? 1.5;
    this.TP_PCT = config.tpPct ?? 6.0;
  }

  public checkSignal(ohlcvData: OHLCV[]): StrategySignal {
    const noSignal: StrategySignal = {
      signal: "NONE",
      entryPrice: 0,
      stopLossPrice: 0,
      takeProfitPrice: 0,
    };

    if (
      ohlcvData.length <
      this.EMA_PERIOD + this.RSI_PERIOD + this.RSI_SMA_PERIOD + 10
    ) {
      return noSignal;
    }

    const currentCandle = ohlcvData[ohlcvData.length - 1];
    const closes = ohlcvData.map((d) => d.close);

    const ema = IndicatorService.computeEMA(closes, this.EMA_PERIOD);

    // Build a rolling window of RSI values large enough for RSI SMA + lookback
    const minRequired = this.RSI_SMA_PERIOD + this.CONFIRMATION_LOOKBACK + 1;
    const rsiValues: number[] = [];

    // Compute RSI over the full available bot memory (up to historyLimit)
    // This allows Wilder's smoothing to properly warm up and prevents indicator drift
    const allRsi = IndicatorService.computeWilderRSISeries(
      closes,
      this.RSI_PERIOD,
    );
    rsiValues.push(...allRsi.slice(-minRequired));

    const currentRsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues[rsiValues.length - 2];

    const currentRsiSma = IndicatorService.computeSMA(
      rsiValues,
      this.RSI_SMA_PERIOD,
    );
    const prevRsiHistory = rsiValues.slice(0, -1);
    const prevRsiSma = IndicatorService.computeSMA(
      prevRsiHistory,
      this.RSI_SMA_PERIOD,
    );

    const recentRsi = rsiValues.slice(-this.CONFIRMATION_LOOKBACK);
    const wasOversold = recentRsi.some((v) => v < this.OVERSOLD_THRESHOLD);
    const wasOverbought = recentRsi.some((v) => v > this.OVERBOUGHT_THRESHOLD);

    // LONG: close > EMA, RSI crosses above its SMA, confirmed oversold recently
    if (
      currentCandle.close > ema &&
      prevRsi < prevRsiSma &&
      currentRsi > currentRsiSma &&
      wasOversold
    ) {
      const entry = currentCandle.close;
      return {
        signal: "LONG",
        entryPrice: entry,
        stopLossPrice: entry * (1 - this.SL_PCT / 100),
        takeProfitPrice: entry * (1 + this.TP_PCT / 100),
      };
    }

    // SHORT: close < EMA, RSI crosses below its SMA, confirmed overbought recently
    if (
      currentCandle.close < ema &&
      prevRsi > prevRsiSma &&
      currentRsi < currentRsiSma &&
      wasOverbought
    ) {
      const entry = currentCandle.close;
      return {
        signal: "SHORT",
        entryPrice: entry,
        stopLossPrice: entry * (1 + this.SL_PCT / 100),
        takeProfitPrice: entry * (1 - this.TP_PCT / 100),
      };
    }

    return noSignal;
  }
}
