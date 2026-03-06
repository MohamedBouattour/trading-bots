import { MathUtils } from "../utils/MathUtils";

export class IndicatorService {
  static computeATR(closes: number[], period: number = 14): number {
    const changes = closes.slice(1).map((c, i) => Math.abs(c - closes[i]));
    if (changes.length < period) return 0;
    return changes.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  static computeVolatility(closes: number[], lookback_period: number): number {
    if (closes.length < 2) return 0.01;
    const lookback = closes.slice(-lookback_period);
    const log_ret: number[] = [];
    for (let i = 1; i < lookback.length; i++) {
      const prev = lookback[i - 1] === 0 ? 1 : lookback[i - 1];
      log_ret.push(Math.log(lookback[i] / prev));
    }
    return log_ret.length > 0 ? MathUtils.stdDev(log_ret) : 0.01;
  }

  static computeTrend(
    closes: number[],
    trend_period: number,
    trend_threshold: number,
  ): "uptrend" | "downtrend" | "ranging" {
    if (closes.length < trend_period + 1) return "ranging";

    const n = closes.length;
    let sum_last = 0;
    let sum_prev = 0;
    for (let i = 0; i < trend_period; i++) {
      sum_last += closes[n - 1 - i];
      sum_prev += closes[n - 2 - i];
    }
    const ma_last = sum_last / trend_period;
    const ma_prev = sum_prev / trend_period;

    const prev = ma_prev === 0 ? 1 : ma_prev;
    const slope = (ma_last - ma_prev) / prev;
    if (slope > trend_threshold) return "uptrend";
    if (slope < -trend_threshold) return "downtrend";
    return "ranging";
  }

  static computeSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] ?? 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  static computeRSI(data: number[], period: number = 14): number {
    if (data.length < period + 1) return 50;
    const slice = data.slice(-(period + 1));
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i] - slice[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    if (losses === 0) return 100;
    const rs = gains / period / (losses / period);
    return 100 - 100 / (1 + rs);
  }
}
