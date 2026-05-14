import { Candle } from '@trading-bots/shared-types';

export interface StrategySignal {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reason: string;
}

export class StrategyEngine {
  evaluate(
    candles: Candle[],
    strategyType: string,
    config: Record<string, unknown>,
  ): StrategySignal[] {
    const signals: StrategySignal[] = [];

    for (let i = 0; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      signals.push(this.getSignal(slice, strategyType, config));
    }

    return signals;
  }

  getSignal(
    candles: Candle[],
    strategyType: string,
    config: Record<string, unknown>,
  ): StrategySignal {
    const closes = candles.map(c => c.close);

    switch (strategyType) {
      case 'ma_crossover':
        return this.maCrossover(closes, config);
      case 'rsi':
        return this.rsiSignal(candles, config);
      case 'bollinger':
        return this.bollinger(closes, config);
      case 'macd':
        return this.macd(closes, config);
      default:
        return { action: 'hold', confidence: 0, reason: `Unknown type: ${strategyType}` };
    }
  }

  sma(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  ema(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  rsi(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 50;
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  private maCrossover(closes: number[], config: Record<string, unknown>): StrategySignal {
    const fastPeriod = (config.fastPeriod as number) ?? 10;
    const slowPeriod = (config.slowPeriod as number) ?? 30;

    if (closes.length < slowPeriod + 1) {
      return { action: 'hold', confidence: 0, reason: 'Not enough data' };
    }

    const fastSma = this.sma(closes, fastPeriod);
    const slowSma = this.sma(closes, slowPeriod);
    const prevFast = this.sma(closes.slice(0, -1), fastPeriod);
    const prevSlow = this.sma(closes.slice(0, -1), slowPeriod);

    if (prevFast <= prevSlow && fastSma > slowSma) {
      return { action: 'buy', confidence: 80, reason: 'Golden cross' };
    }
    if (prevFast >= prevSlow && fastSma < slowSma) {
      return { action: 'sell', confidence: 80, reason: 'Death cross' };
    }
    return { action: 'hold', confidence: 50, reason: 'No crossover' };
  }

  private rsiSignal(candles: Candle[], config: Record<string, unknown>): StrategySignal {
    const rsiPeriod = (config.rsiPeriod as number) ?? 14;
    const oversold = (config.oversold as number) ?? 30;
    const overbought = (config.overbought as number) ?? 70;

    if (candles.length < rsiPeriod + 1) {
      return { action: 'hold', confidence: 0, reason: 'Not enough data' };
    }

    const rsiValue = this.rsi(candles, rsiPeriod);
    const prevRsi = this.rsi(candles.slice(0, -1), rsiPeriod);

    if (prevRsi <= oversold && rsiValue > oversold) {
      return { action: 'buy', confidence: 90, reason: `RSI oversold: ${rsiValue.toFixed(2)}` };
    }
    if (prevRsi >= overbought && rsiValue < overbought) {
      return { action: 'sell', confidence: 90, reason: `RSI overbought: ${rsiValue.toFixed(2)}` };
    }
    return { action: 'hold', confidence: 50, reason: `RSI neutral: ${rsiValue.toFixed(2)}` };
  }

  private bollinger(closes: number[], config: Record<string, unknown>): StrategySignal {
    const period = (config.period as number) ?? 20;
    const stdDev = (config.stdDev as number) ?? 2;

    if (closes.length < period) {
      return { action: 'hold', confidence: 0, reason: 'Not enough data' };
    }

    const sma = this.sma(closes, period);
    const sqDiffs = closes.slice(-period).map(p => (p - sma) ** 2);
    const std = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / period);
    const current = closes[closes.length - 1];
    const lowerBand = sma - stdDev * std;
    const upperBand = sma + stdDev * std;

    if (current <= lowerBand) {
      return { action: 'buy', confidence: 85, reason: 'Price at lower band' };
    }
    if (current >= upperBand) {
      return { action: 'sell', confidence: 85, reason: 'Price at upper band' };
    }
    return { action: 'hold', confidence: 50, reason: 'Price within bands' };
  }

  private macd(closes: number[], config: Record<string, unknown>): StrategySignal {
    const fastPeriod = (config.fastPeriod as number) ?? 12;
    const slowPeriod = (config.slowPeriod as number) ?? 26;
    const signalPeriod = (config.signalPeriod as number) ?? 9;

    if (closes.length < slowPeriod + signalPeriod) {
      return { action: 'hold', confidence: 0, reason: 'Not enough data' };
    }

    const fastEma = this.ema(closes, fastPeriod);
    const slowEma = this.ema(closes, slowPeriod);
    const macdLine = fastEma - slowEma;

    const prevFast = this.ema(closes.slice(0, -1), fastPeriod);
    const prevSlow = this.ema(closes.slice(0, -1), slowPeriod);
    const prevMacd = prevFast - prevSlow;

    const emaData = closes.map((_, i) => {
      const slice = closes.slice(0, i + 1);
      if (slice.length < slowPeriod) return 0;
      return this.ema(slice, fastPeriod) - this.ema(slice, slowPeriod);
    }).filter(v => v !== 0);

    if (emaData.length < signalPeriod) {
      return { action: 'hold', confidence: 0, reason: 'Not enough data' };
    }

    const signal = this.sma(emaData, signalPeriod);
    const prevSignal = this.sma(emaData.slice(0, -1), signalPeriod);

    if (prevMacd <= prevSignal && macdLine > signal) {
      return { action: 'buy', confidence: 75, reason: 'MACD bullish crossover' };
    }
    if (prevMacd >= prevSignal && macdLine < signal) {
      return { action: 'sell', confidence: 75, reason: 'MACD bearish crossover' };
    }
    return { action: 'hold', confidence: 50, reason: 'MACD neutral' };
  }
}
