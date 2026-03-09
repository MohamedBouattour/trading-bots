import { MathUtils } from "../utils/MathUtils";

export class IndicatorService {
  static computeATR(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 0;
    const changes = [];
    for (let i = closes.length - period; i < closes.length; i++) {
        changes.push(Math.abs(closes[i] - closes[i-1]));
    }
    return changes.reduce((a, b) => a + b, 0) / period;
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
    const rs = (gains / period) / (losses / period);
    return 100 - 100 / (1 + rs);
  }

  static computeBollingerBands(data: number[], period: number = 20, stdDevMult: number = 2): { upper: number, middle: number, lower: number } {
    if (data.length < period) {
        const last = data[data.length - 1] || 0;
        return { upper: last, middle: last, lower: last };
    }
    const slice = data.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    const stdDev = MathUtils.stdDev(slice);
    
    return {
      upper: middle + stdDevMult * stdDev,
      middle: middle,
      lower: middle - stdDevMult * stdDev
    };
  }

  static computeVolumeSMA(volumes: number[], period: number = 20): number {
    if (volumes.length < period) return volumes[volumes.length - 1] || 0;
    const slice = volumes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  static computeEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    // Standard initialization: SMA of first 'period' elements
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    // Recursive calculation for the rest
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  static computeATR_HL(highs: number[], lows: number[], closes: number[], period: number): number {
    if (closes.length < period + 1) return 0;
    let trSum = 0;
    const start = closes.length - period;
    for (let i = start; i < closes.length; i++) {
      const hl = highs[i] - lows[i];
      const hpc = Math.abs(highs[i] - closes[i - 1]);
      const lpc = Math.abs(lows[i] - closes[i - 1]);
      trSum += Math.max(hl, hpc, lpc);
    }
    return trSum / period;
  }

  static computeADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (closes.length < period * 2) return 0;
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const moveUp = highs[i] - highs[i - 1];
      const moveDown = lows[i - 1] - lows[i];
      plusDM.push(moveUp > 0 && moveUp > moveDown ? moveUp : 0);
      minusDM.push(moveDown > 0 && moveDown > moveUp ? moveDown : 0);
    }
    const tr: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    const smoothedPlusDM = this.computeEMA(plusDM, period);
    const smoothedMinusDM = this.computeEMA(minusDM, period);
    const smoothedTR = this.computeEMA(tr, period);
    if (smoothedTR === 0) return 0;
    const plusDI = 100 * (smoothedPlusDM / smoothedTR);
    const minusDI = 100 * (smoothedMinusDM / smoothedTR);
    const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);
    return dx;
  }
}
