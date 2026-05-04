import type { Candle } from '../models/Candle.js';
import type { IndicatorDeclaration } from '../models/StrategyBlueprint.js';

export type IndicatorValues = Record<string, number>;

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
