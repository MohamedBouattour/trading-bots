import { describe, it, expect } from 'vitest';
import { RiskManager } from '../RiskManager.js';
import type { BotState } from '../../models/BotState.js';
import type { RiskConfig } from '../../models/StrategyBlueprint.js';
import type { TradeRecord } from '../../models/TradeRecord.js';

const rm = new RiskManager();

const baseState: BotState = {
  strategyId: 'test',
  status: 'idle',
  lastRunAt: 0,
  openTrades: [],
  closedTrades: [],
  equityHistory: [],
  ruleHits: [],
  initialBalance: 10_000,
  currentBalance: 10_000,
  dailyLoss: 0,
  dailyLossResetAt: Date.now(),
};

const baseRisk: RiskConfig = {
  maxDrawdownPct: 20,
  maxPositionPct: 10,
  dailyLossLimitPct: 5,
};

describe('RiskManager.checkPortfolioRisk', () => {
  it('does not breach when within limits', () => {
    const result = rm.checkPortfolioRisk(baseState, baseRisk, 9_500);
    expect(result.breached).toBe(false);
  });

  it('breaches on max drawdown exceeded', () => {
    const result = rm.checkPortfolioRisk(baseState, baseRisk, 7_000);
    expect(result.breached).toBe(true);
    expect(result.reason).toMatch(/drawdown/);
  });

  it('breaches on daily loss limit exceeded', () => {
    const state = { ...baseState, dailyLoss: 600 }; // 6% of 10k > 5% limit
    const result = rm.checkPortfolioRisk(state, baseRisk, 9_900);
    expect(result.breached).toBe(true);
    expect(result.reason).toMatch(/daily loss/);
  });
});

describe('RiskManager.computeStopLossPrice', () => {
  it('computes fixed_pct stop-loss for LONG', () => {
    const sl = rm.computeStopLossPrice(100, 'LONG', { ...baseRisk, stopLossMode: 'fixed_pct', stopLossFixedPct: 5 });
    expect(sl).toBeCloseTo(95);
  });

  it('computes fixed_pct stop-loss for SHORT', () => {
    const sl = rm.computeStopLossPrice(100, 'SHORT', { ...baseRisk, stopLossMode: 'fixed_pct', stopLossFixedPct: 5 });
    expect(sl).toBeCloseTo(105);
  });

  it('computes ATR-based stop-loss', () => {
    const sl = rm.computeStopLossPrice(100, 'LONG', { ...baseRisk, stopLossMode: 'atr', stopLossAtrMultiplier: 2 }, 3);
    expect(sl).toBeCloseTo(94);
  });

  it('returns undefined when no stop-loss configured', () => {
    const sl = rm.computeStopLossPrice(100, 'LONG', baseRisk);
    expect(sl).toBeUndefined();
  });
});

describe('RiskManager.isTakeProfitTriggered', () => {
  const trade: TradeRecord = {
    id: '1', strategyId: 'test', symbol: 'BTCUSDT', direction: 'LONG',
    status: 'OPEN', entryPrice: 100, quantity: 1, leverage: 1,
    entryTime: Date.now(), triggeredRuleId: 'r1',
  };

  it('triggers TP when gain exceeds threshold (LONG)', () => {
    expect(rm.isTakeProfitTriggered(trade, 115, 10)).toBe(true);
  });

  it('does not trigger TP when gain is below threshold', () => {
    expect(rm.isTakeProfitTriggered(trade, 105, 10)).toBe(false);
  });
});

describe('RiskManager.maxPositionSizeUsd', () => {
  it('returns correct position size', () => {
    expect(rm.maxPositionSizeUsd(10_000, 10)).toBe(1_000);
  });
});
