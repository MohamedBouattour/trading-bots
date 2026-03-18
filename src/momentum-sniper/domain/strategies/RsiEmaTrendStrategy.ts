import { IndicatorService } from "../../../shared/indicators/IndicatorService";

/**
 * Signal side for the trading strategy.
 */
export type SignalSide = "LONG" | "SHORT" | "NONE";

/**
 * Interface representing a single candle's data.
 */
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Interface for the signal output metadata.
 */
export interface StrategySignal {
  signal: SignalSide;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}

/**
 * Optimized RSI + 100 EMA Trend Follower Strategy.
 */
export class RsiEmaTrendStrategy {
  private readonly EMA_PERIOD = 100;
  private readonly RSI_PERIOD = 7;
  private readonly RSI_SMA_PERIOD = 7;
  private readonly OVERSOLD_THRESHOLD = 40;
  private readonly OVERBOUGHT_THRESHOLD = 60;
  private readonly CONFIRMATION_LOOKBACK = 5;

  private readonly SL_PCT = 1.5;
  private readonly TP_PCT = 6.0;

  /**
   * Check for a trading signal based on historical OHLCV data.
   * @param ohlcvData Array of OHLCV data, sorted by timestamp ascending.
   * @returns StrategySignal object containing the signal and trade parameters.
   */
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
    const _prevCandle = ohlcvData[ohlcvData.length - 2];
    const closes = ohlcvData.map((d) => d.close);

    // Calculate Indicators
    const ema100Current = IndicatorService.computeEMA(closes, this.EMA_PERIOD);

    // RSI 7
    const rsiValues: number[] = [];
    const minRequiredForRsiSma =
      this.RSI_SMA_PERIOD + this.CONFIRMATION_LOOKBACK + 1;

    for (
      let i = ohlcvData.length - minRequiredForRsiSma;
      i < ohlcvData.length;
      i++
    ) {
      rsiValues.push(
        IndicatorService.computeRSI(closes.slice(0, i + 1), this.RSI_PERIOD),
      );
    }

    const currentRsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues[rsiValues.length - 2];

    // RSI SMA 7
    const currentRsiSma = IndicatorService.computeSMA(
      rsiValues,
      this.RSI_SMA_PERIOD,
    );
    const prevRsiHistory = rsiValues.slice(0, -1);
    const prevRsiSma = IndicatorService.computeSMA(
      prevRsiHistory,
      this.RSI_SMA_PERIOD,
    );

    // Confirmation logic: RSI 7 < 40 or RSI 7 > 60 within last 5 candles
    const recentRsiHistory = rsiValues.slice(-this.CONFIRMATION_LOOKBACK);
    const wasOversold = recentRsiHistory.some(
      (v) => v < this.OVERSOLD_THRESHOLD,
    );
    const wasOverbought = recentRsiHistory.some(
      (v) => v > this.OVERBOUGHT_THRESHOLD,
    );

    // Entry Logic
    // Long Entry: close > EMA 100, RSI crosses above RSI SMA 7, confirmed by oversold
    if (
      currentCandle.close > ema100Current &&
      prevRsi < prevRsiSma &&
      currentRsi > currentRsiSma &&
      wasOversold
    ) {
      const entryPrice = currentCandle.close;
      return {
        signal: "LONG",
        entryPrice: entryPrice,
        stopLossPrice: entryPrice * (1 - this.SL_PCT / 100),
        takeProfitPrice: entryPrice * (1 + this.TP_PCT / 100),
      };
    }

    // Short Entry: close < EMA 100, RSI crosses below RSI SMA 7, confirmed by overbought
    if (
      currentCandle.close < ema100Current &&
      prevRsi > prevRsiSma &&
      currentRsi < currentRsiSma &&
      wasOverbought
    ) {
      const entryPrice = currentCandle.close;
      return {
        signal: "SHORT",
        entryPrice: entryPrice,
        stopLossPrice: entryPrice * (1 + this.SL_PCT / 100),
        takeProfitPrice: entryPrice * (1 - this.TP_PCT / 100),
      };
    }

    return noSignal;
  }
}
