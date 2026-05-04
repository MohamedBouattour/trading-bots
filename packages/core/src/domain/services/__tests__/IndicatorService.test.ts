import { describe, it, expect } from 'vitest';
import { IndicatorService } from '../IndicatorService.js';
import type { Candle } from '../../models/Candle.js';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    openTime: i * 60_000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
    closeTime: i * 60_000 + 59_999,
  }));
}

const svc = new IndicatorService();
const tf = '1h';

describe('IndicatorService', () => {
  // ── SMA ────────────────────────────────────────────────────────────────────
  it('SMA returns correct average', () => {
    const candles = makeCandles([1, 2, 3, 4, 5]);
    const val = svc.compute({ id: 'sma3', type: 'SMA', params: { period: 3 }, timeframe: tf }, candles);
    expect(val).toBeCloseTo((3 + 4 + 5) / 3);
  });

  it('SMA returns NaN when insufficient data', () => {
    const candles = makeCandles([1, 2]);
    const val = svc.compute({ id: 'sma10', type: 'SMA', params: { period: 10 }, timeframe: tf }, candles);
    expect(val).toBeNaN();
  });

  // ── EMA ────────────────────────────────────────────────────────────────────
  it('EMA converges toward latest value on flat series', () => {
    const closes = Array(30).fill(100);
    const candles = makeCandles(closes);
    const val = svc.compute({ id: 'ema12', type: 'EMA', params: { period: 12 }, timeframe: tf }, candles);
    expect(val).toBeCloseTo(100, 4);
  });

  // ── RSI ────────────────────────────────────────────────────────────────────
  it('RSI returns 100 when no losses', () => {
    const candles = makeCandles([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    const val = svc.compute({ id: 'rsi14', type: 'RSI', params: { period: 14 }, timeframe: tf }, candles);
    expect(val).toBe(100);
  });

  it('RSI returns NaN when insufficient data', () => {
    const candles = makeCandles([10, 11]);
    const val = svc.compute({ id: 'rsi14', type: 'RSI', params: { period: 14 }, timeframe: tf }, candles);
    expect(val).toBeNaN();
  });

  // ── ATR ────────────────────────────────────────────────────────────────────
  it('ATR is positive for volatile candles', () => {
    const candles = makeCandles(Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 5));
    const val = svc.compute({ id: 'atr14', type: 'ATR', params: { period: 14 }, timeframe: tf }, candles);
    expect(val).toBeGreaterThan(0);
  });

  // ── VWAP ───────────────────────────────────────────────────────────────────
  it('VWAP equals close on uniform candles', () => {
    const candles = makeCandles([100, 100, 100]);
    const val = svc.compute({ id: 'vwap', type: 'VWAP', params: {}, timeframe: tf }, candles);
    expect(val).toBeCloseTo(100);
  });

  // ── MACD ───────────────────────────────────────────────────────────────────
  it('MACD returns 0 on flat series', () => {
    const candles = makeCandles(Array(30).fill(50));
    const val = svc.compute({ id: 'macd', type: 'MACD', params: { fast: 12, slow: 26 }, timeframe: tf }, candles);
    expect(val).toBeCloseTo(0, 4);
  });

  it('MACD is positive when fast EMA > slow EMA (rising prices)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const candles = makeCandles(closes);
    const val = svc.compute({ id: 'macd', type: 'MACD', params: { fast: 12, slow: 26 }, timeframe: tf }, candles);
    expect(val).toBeGreaterThan(0);
  });

  it('MACD returns NaN when insufficient data', () => {
    const candles = makeCandles([100, 101, 102]);
    const val = svc.compute({ id: 'macd', type: 'MACD', params: { fast: 12, slow: 26 }, timeframe: tf }, candles);
    expect(val).toBeNaN();
  });

  // ── Bollinger Bands ────────────────────────────────────────────────────────
  it('BB upper > BB middle > BB lower', () => {
    const candles = makeCandles(Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 10));
    const params = { period: 20, stdDev: 2 };
    const upper  = svc.compute({ id: 'bbu', type: 'BB', params: { ...params, band: 1 },  timeframe: tf }, candles);
    const middle = svc.compute({ id: 'bbm', type: 'BB', params: { ...params, band: 0 },  timeframe: tf }, candles);
    const lower  = svc.compute({ id: 'bbl', type: 'BB', params: { ...params, band: -1 }, timeframe: tf }, candles);
    expect(upper).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(lower);
  });

  it('BB returns NaN when insufficient data', () => {
    const candles = makeCandles([100, 101]);
    const val = svc.compute({ id: 'bbu', type: 'BB', params: { period: 20, stdDev: 2, band: 1 }, timeframe: tf }, candles);
    expect(val).toBeNaN();
  });
});
