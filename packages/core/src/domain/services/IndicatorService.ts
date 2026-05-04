import { Candle } from "../models/Candle";
import { IndicatorDeclaration } from "../models/StrategyBlueprint";

/**
 * Pure indicator computation service.
 * Takes candles + an IndicatorDeclaration and returns a single number.
 * Zero side effects. Easy to extend: add a new case in compute().
 */
export class IndicatorService {
  static compute(decl: IndicatorDeclaration, candles: Candle[]): number {
    const closes = candles.map((c) => c.close);
    const p = decl.params;

    switch (decl.type) {
      case "SMA":       return IndicatorService.sma(closes, p.period ?? 14);
      case "EMA":       return IndicatorService.ema(closes, p.period ?? 14);
      case "RSI":       return IndicatorService.rsi(closes, p.period ?? 14);
      case "ATR":       return IndicatorService.atr(candles, p.period ?? 14);
      case "VWAP":      return IndicatorService.vwap(candles);
      case "VOLUME_MA": return IndicatorService.sma(candles.map((c) => c.volume), p.period ?? 20);
      default:          return 0;
    }
  }

  static sma(data: number[], period: number): number {
    if (data.length < period) return data.at(-1) ?? 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  static ema(data: number[], period: number): number {
    if (data.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
  }

  static rsi(data: number[], period = 14): number {
    if (data.length < period + 1) return 50;
    const slice = data.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i] - slice[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    return 100 - 100 / (1 + rs);
  }

  static atr(candles: Candle[], period = 14): number {
    if (candles.length < period + 1) return 0;
    const slice = candles.slice(-period);
    const trs = slice.map((c, i) => {
      if (i === 0) return c.high - c.low;
      const prev = slice[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    });
    return trs.reduce((a, b) => a + b, 0) / period;
  }

  static vwap(candles: Candle[]): number {
    let cumPV = 0, cumVol = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      cumPV += tp * c.volume;
      cumVol += c.volume;
    }
    return cumVol === 0 ? 0 : cumPV / cumVol;
  }

  /** Std deviation helper used by volatility calculations */
  static stdDev(data: number[]): number {
    if (data.length < 2) return 0;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((s, x) => s + (x - mean) ** 2, 0) / data.length;
    return Math.sqrt(variance);
  }
}
