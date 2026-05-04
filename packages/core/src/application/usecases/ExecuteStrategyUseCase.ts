import type { StrategyBlueprint } from '../../domain/models/StrategyBlueprint.js';
import type { BotState } from '../../domain/models/BotState.js';
import type { IMarketDataProvider } from '../ports/IMarketDataProvider.js';
import type { ITradeExecutor } from '../ports/ITradeExecutor.js';
import type { IStateStore } from '../ports/IStateStore.js';
import type { ILogger } from '../ports/ILogger.js';
import { IndicatorService } from '../../domain/services/IndicatorService.js';
import { ConditionEvaluator } from '../../domain/services/ConditionEvaluator.js';
import { RiskManager } from '../../domain/services/RiskManager.js';
import type { Candle } from '../../domain/models/Candle.js';
import type { TradeRecord } from '../../domain/models/TradeRecord.js';

const ONE_DAY_MS = 86_400_000;

function makeInitialState(blueprint: StrategyBlueprint, balance: number): BotState {
  return {
    strategyId: blueprint.id,
    status: 'idle',
    lastRunAt: 0,
    openTrades: [],
    closedTrades: [],
    equityHistory: [],
    ruleHits: blueprint.rules.map((r) => ({ ruleId: r.id, count: 0 })),
    initialBalance: balance,
    currentBalance: balance,
    dailyLoss: 0,
    dailyLossResetAt: Date.now(),
  };
}

export class ExecuteStrategyUseCase {
  private indicators = new IndicatorService();
  private evaluator  = new ConditionEvaluator();
  private riskMgr    = new RiskManager();

  constructor(
    private market:   IMarketDataProvider,
    private executor: ITradeExecutor,
    private store:    IStateStore,
    private logger:   ILogger
  ) {}

  async run(blueprint: StrategyBlueprint): Promise<void> {
    const balance = await this.market.getAccountBalance();
    let state = (await this.store.load(blueprint.id)) ?? makeInitialState(blueprint, balance);

    if (state.status === 'halted') {
      this.logger.warn('Strategy halted, skipping run', { strategyId: blueprint.id, reason: state.haltReason });
      return;
    }

    // Reset daily loss counter if a new trading day has started
    if (Date.now() - state.dailyLossResetAt > ONE_DAY_MS) {
      state.dailyLoss = 0;
      state.dailyLossResetAt = Date.now();
    }

    state.status = 'running';
    state.lastRunAt = Date.now();
    state.currentBalance = balance;

    // Collect unique timeframes and fetch candles
    const timeframes = [...new Set(blueprint.indicators.map((i) => i.timeframe))];
    const candlesByTimeframe = new Map<string, Candle[]>();
    for (const tf of timeframes) {
      const candles = await this.market.getCandles(blueprint.symbols[0], tf, 250);
      candlesByTimeframe.set(tf, candles);
    }

    // Compute all indicator values
    const indicatorValues = this.indicators.computeAll(blueprint.indicators, candlesByTimeframe);
    this.logger.debug('Indicators computed', { strategyId: blueprint.id, values: indicatorValues });

    // Resolve latest candle for price references
    const primaryCandles = candlesByTimeframe.get(blueprint.indicators[0]?.timeframe ?? '1h') ?? [];
    const latestCandle   = primaryCandles[primaryCandles.length - 1];
    if (!latestCandle) {
      this.logger.warn('No candle data, skipping', { strategyId: blueprint.id });
      await this.store.save(state);
      return;
    }

    // ── Per-symbol loop ──────────────────────────────────────────────────────
    for (const symbol of blueprint.symbols) {
      const currentPrice = await this.market.getLatestPrice(symbol);

      // ── Stop-loss & take-profit checks on open positions ──────────────────
      const openTrades = state.openTrades.filter((t) => t.symbol === symbol && t.status === 'OPEN');
      for (const trade of openTrades) {
        const rm = blueprint.riskManagement;

        // Compute ATR for ATR-based stop-loss (reuse the primary timeframe)
        const atrDecl = blueprint.indicators.find((i) => i.type === 'ATR');
        const atrValue = atrDecl ? indicatorValues[atrDecl.id] : undefined;

        const slPrice = this.riskMgr.computeStopLossPrice(
          trade.entryPrice, trade.direction, rm, atrValue
        );

        // Trailing stop: update high-water mark, then recompute stop
        let effectiveSlPrice = slPrice;
        if (rm.trailingStopPct !== undefined) {
          const hwm = trade.direction === 'LONG'
            ? Math.max(trade.entryPrice, currentPrice)
            : Math.min(trade.entryPrice, currentPrice);
          const trailingPrice = this.riskMgr.computeTrailingStopPrice(hwm, trade.direction, rm.trailingStopPct);
          // Use the more protective of the two
          if (trade.direction === 'LONG') {
            effectiveSlPrice = slPrice !== undefined ? Math.max(slPrice, trailingPrice) : trailingPrice;
          } else {
            effectiveSlPrice = slPrice !== undefined ? Math.min(slPrice, trailingPrice) : trailingPrice;
          }
        }

        const slTriggered = effectiveSlPrice !== undefined &&
          this.riskMgr.isStopLossTriggered(trade, currentPrice, effectiveSlPrice);

        const tpPct = rm.takeProfitPct ?? trade.triggeredRuleId ? undefined : undefined;
        const tpTriggered = rm.takeProfitPct !== undefined &&
          this.riskMgr.isTakeProfitTriggered(trade, currentPrice, rm.takeProfitPct);

        if (slTriggered || tpTriggered) {
          const reason = slTriggered ? 'stop-loss' : 'take-profit';
          this.logger.info(`Closing trade via ${reason}`, { strategyId: blueprint.id, tradeId: trade.id, symbol });
          const closed = await this.executor.closePosition(trade, currentPrice);
          state.openTrades   = state.openTrades.filter((t) => t.id !== trade.id);
          state.closedTrades.push(closed);
          if ((closed.pnlUsd ?? 0) < 0) state.dailyLoss += Math.abs(closed.pnlUsd ?? 0);
        }
      }

      // ── Portfolio-level risk gate ─────────────────────────────────────────
      const riskCheck = this.riskMgr.checkPortfolioRisk(state, blueprint.riskManagement, balance);
      if (riskCheck.breached) {
        state.status     = 'halted';
        state.haltReason = riskCheck.reason;
        this.logger.warn('Bot halted due to risk breach', { strategyId: blueprint.id, reason: riskCheck.reason });
        break;
      }

      // ── Rule evaluation (highest priority first) ──────────────────────────
      const sortedRules = [...blueprint.rules].sort((a, b) => a.priority - b.priority);
      for (const rule of sortedRules) {
        const triggered = this.evaluator.evaluate(rule.conditionGroup, indicatorValues, latestCandle);
        if (!triggered) continue;

        this.logger.info('Rule triggered', { strategyId: blueprint.id, ruleId: rule.id, action: rule.action, symbol });

        const hit = state.ruleHits.find((h) => h.ruleId === rule.id);
        if (hit) hit.count += 1;

        if (rule.action === 'BUY' || rule.action === 'SELL') {
          // Respect maxPositionPct
          const maxSizeUsd = this.riskMgr.maxPositionSizeUsd(
            balance, blueprint.riskManagement.maxPositionPct
          );
          const cappedParams = {
            ...rule.params,
            // If sizeMode is fixed_usd, cap to maxPositionSizeUsd
            sizeValue: rule.params.sizeMode === 'fixed_usd'
              ? Math.min(rule.params.sizeValue, maxSizeUsd)
              : rule.params.sizeValue,
          };
          const trade = await this.executor.execute(symbol, rule.action, cappedParams, currentPrice, balance);
          state.openTrades.push(trade);
        } else if (rule.action === 'CLOSE' || rule.action === 'TAKE_PROFIT') {
          const open = state.openTrades.find((t) => t.symbol === symbol && t.status === 'OPEN');
          if (open) {
            const closed = await this.executor.closePosition(open, currentPrice);
            state.openTrades    = state.openTrades.filter((t) => t.id !== open.id);
            state.closedTrades.push(closed);
            if ((closed.pnlUsd ?? 0) < 0) state.dailyLoss += Math.abs(closed.pnlUsd ?? 0);
          }
        }

        break; // Only fire highest-priority matched rule per symbol per cycle
      }

      if (state.status === 'halted') break;
    }

    // ── Equity snapshot ───────────────────────────────────────────────────────
    state.equityHistory.push({ timestamp: Date.now(), equity: balance });
    if (state.equityHistory.length > 1000) state.equityHistory = state.equityHistory.slice(-1000);

    if (state.status === 'running') state.status = 'idle';
    await this.store.save(state);
    this.logger.info('Strategy cycle complete', { strategyId: blueprint.id });
  }
}
