import type { BotState } from '../models/BotState.js';
import type { RiskConfig } from '../models/StrategyBlueprint.js';
import type { TradeRecord } from '../models/TradeRecord.js';

export interface RiskCheckResult {
  breached: boolean;
  reason?: string;
}

/**
 * RiskManager — stateless helper that enforces risk rules.
 * All methods are pure functions (no side-effects) so they are trivially testable.
 */
export class RiskManager {
  /**
   * Returns whether any portfolio-level risk limit has been exceeded.
   */
  checkPortfolioRisk(
    state: BotState,
    risk: RiskConfig,
    currentBalance: number
  ): RiskCheckResult {
    const drawdownPct =
      ((state.initialBalance - currentBalance) / state.initialBalance) * 100;

    if (drawdownPct >= risk.maxDrawdownPct) {
      return {
        breached: true,
        reason: `Max drawdown ${risk.maxDrawdownPct}% reached (current: ${drawdownPct.toFixed(2)}%)`,
      };
    }

    const dailyLossPct = (state.dailyLoss / state.initialBalance) * 100;
    if (dailyLossPct >= risk.dailyLossLimitPct) {
      return {
        breached: true,
        reason: `Daily loss limit ${risk.dailyLossLimitPct}% reached (current: ${dailyLossPct.toFixed(2)}%)`,
      };
    }

    return { breached: false };
  }

  /**
   * Computes stop-loss price for a trade based on the risk config.
   * Returns undefined if no stop-loss is configured.
   */
  computeStopLossPrice(
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    risk: RiskConfig,
    atrValue?: number
  ): number | undefined {
    if (risk.stopLossMode === 'fixed_pct' && risk.stopLossFixedPct !== undefined) {
      const offset = entryPrice * (risk.stopLossFixedPct / 100);
      return direction === 'LONG' ? entryPrice - offset : entryPrice + offset;
    }

    if (risk.stopLossMode === 'atr' && atrValue !== undefined && risk.stopLossAtrMultiplier !== undefined) {
      const offset = atrValue * risk.stopLossAtrMultiplier;
      return direction === 'LONG' ? entryPrice - offset : entryPrice + offset;
    }

    return undefined;
  }

  /**
   * Computes the trailing stop price based on the highest seen price (for LONG)
   * or the lowest seen price (for SHORT).
   */
  computeTrailingStopPrice(
    highWaterMark: number,
    direction: 'LONG' | 'SHORT',
    trailingStopPct: number
  ): number {
    const offset = highWaterMark * (trailingStopPct / 100);
    return direction === 'LONG' ? highWaterMark - offset : highWaterMark + offset;
  }

  /**
   * Returns true when a trade should be stopped out at the current price.
   */
  isStopLossTriggered(
    trade: TradeRecord,
    currentPrice: number,
    stopLossPrice: number
  ): boolean {
    if (trade.direction === 'LONG')  return currentPrice <= stopLossPrice;
    if (trade.direction === 'SHORT') return currentPrice >= stopLossPrice;
    return false;
  }

  /**
   * Returns true when a trade should be closed at take-profit.
   */
  isTakeProfitTriggered(
    trade: TradeRecord,
    currentPrice: number,
    takeProfitPct: number
  ): boolean {
    const gainPct =
      trade.direction === 'LONG'
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    return gainPct >= takeProfitPct;
  }

  /**
   * Calculates maximum position size in USD respecting maxPositionPct.
   */
  maxPositionSizeUsd(balance: number, maxPositionPct: number): number {
    return balance * (maxPositionPct / 100);
  }
}
