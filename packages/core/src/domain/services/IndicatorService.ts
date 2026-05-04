import type { Candle } from '../models/Candle.js';
import type { IndicatorDeclaration } from '../models/StrategyBlueprint.js';

export type IndicatorValues = Record<string, number>;

// ─── Primitive math helpers ───────────────────────────────────────────────────

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  if (slice.length < period) return NaN;
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const k = 2 / (period + 1);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  const slice = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return NaN;
  const slice = candles.slice(-(period + 1));
  const trs = slice.slice(1).map((c, i) => {
    const prev = slice[i];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / period;
}

function vwap(candles: Candle[]): number {
  let totalVolume = 0, totalPV = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    totalPV += typicalPrice * c.volume;
    totalVolume += c.volume;
  }
  return totalVolume === 0 ? NaN : totalPV / totalVolume;
}

/**
 * MACD — returns the MACD line value (fastEMA − slowEMA).
 * params: { fast?: number; slow?: number }
 * Default: fast=12, slow=26.
 * Use a second declaration with type 'MACD' and params.signal=9 to get the signal line
 * by comparing two MACD declarations in a condition.
 */
function macd(closes: number[], fast: number, slow: number): number {
  if (closes.length < slow) return NaN;
  return ema(closes, fast) - ema(closes, slow);
}

/**
 * Bollinger Bands — returns one of three bands depending on params.band:
 *   band =  1  → upper band  (mean + k*σ)
 *   band =  0  → middle band (SMA)
 *   band = -1  → lower band  (mean − k*σ)
 * params: { period?: number; stdDev?: number; band: -1 | 0 | 1 }
 */
function bollingerBand(closes: number[], period: number, stdDevMult: number, band: number): number {
  if (closes.length < period) return NaN;
  const mean = sma(closes, period);
  if (isNaN(mean)) return NaN;
  const slice = closes.slice(-period);
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  if (band === 1)  return mean + stdDevMult * std;
  if (band === -1) return mean - stdDevMult * std;
  return mean; // band === 0
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class IndicatorService {
  compute(
    declaration: IndicatorDeclaration,
    candles: Candle[]
  ): number {
    const closes = candles.map((c) => c.close);

    switch (declaration.type) {
      case 'SMA':
        return sma(closes, declaration.params.period);

      case 'EMA':
        return ema(closes, declaration.params.period);

      case 'RSI':
        return rsi(closes, declaration.params.period);

      case 'ATR':
        return atr(candles, declaration.params.period);

      case 'VWAP':
        return vwap(candles);

      case 'VOLUME_MA':
        return sma(candles.map((c) => c.volume), declaration.params.period);

      case 'MACD': {
        const fast = declaration.params.fast ?? 12;
        const slow = declaration.params.slow ?? 26;
        return macd(closes, fast, slow);
      }

      case 'BB': {
        const period  = declaration.params.period  ?? 20;
        const stdDev  = declaration.params.stdDev  ?? 2;
        const band    = declaration.params.band    ?? 0; // 1=upper, 0=middle, -1=lower
        return bollingerBand(closes, period, stdDev, band);
      }

      default:
        throw new Error(`Unknown indicator type: ${(declaration as IndicatorDeclaration).type}`);
    }
  }

  computeAll(
    declarations: IndicatorDeclaration[],
    candlesByTimeframe: Map<string, Candle[]>
  ): IndicatorValues {
    const result: IndicatorValues = {};
    for (const decl of declarations) {
      const candles = candlesByTimeframe.get(decl.timeframe) ?? [];
      result[decl.id] = this.compute(decl, candles);
    }
    return result;
  }
}
