import type { StrategyBlueprint } from '../../domain/models/StrategyBlueprint.js';
import type { BotState } from '../../domain/models/BotState.js';
import type { IMarketDataProvider } from '../ports/IMarketDataProvider.js';
import type { ITradeExecutor } from '../ports/ITradeExecutor.js';
import type { IStateStore } from '../ports/IStateStore.js';
import type { ILogger } from '../ports/ILogger.js';
import { IndicatorService } from '../../domain/services/IndicatorService.js';
import { ConditionEvaluator } from '../../domain/services/ConditionEvaluator.js';
import type { Candle } from '../../domain/models/Candle.js';

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
  private evaluator = new ConditionEvaluator();

  constructor(
    private market: IMarketDataProvider,
    private executor: ITradeExecutor,
    private store: IStateStore,
    private logger: ILogger
  ) {}

  async run(blueprint: StrategyBlueprint): Promise<void> {
    const balance = await this.market.getAccountBalance();
    let state = (await this.store.load(blueprint.id)) ?? makeInitialState(blueprint, balance);

    if (state.status === 'halted') {
      this.logger.warn('Strategy halted, skipping run', { strategyId: blueprint.id, reason: state.haltReason });
      return;
    }

    // Reset daily loss counter if new day
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

    // Compute all indicators
    const indicatorValues = this.indicators.computeAll(blueprint.indicators, candlesByTimeframe);
    this.logger.debug('Indicators computed', { strategyId: blueprint.id, values: indicatorValues });

    // Get latest candle for price reference
    const primaryCandles = candlesByTimeframe.get(blueprint.indicators[0]?.timeframe ?? '1h') ?? [];
    const latestCandle = primaryCandles[primaryCandles.length - 1];
    if (!latestCandle) {
      this.logger.warn('No candle data, skipping', { strategyId: blueprint.id });
      await this.store.save(state);
      return;
    }

    // Evaluate rules by priority order
    const sortedRules = [...blueprint.rules].sort((a, b) => a.priority - b.priority);

    for (const symbol of blueprint.symbols) {
      const currentPrice = await this.market.getLatestPrice(symbol);

      for (const rule of sortedRules) {
        const triggered = this.evaluator.evaluate(rule.conditionGroup, indicatorValues, latestCandle);

        if (!triggered) continue;

        // Risk checks
        if (this.isRiskBreached(state, blueprint, balance)) {
          state.status = 'halted';
          state.haltReason = 'Risk management limit reached';
          this.logger.warn('Bot halted due to risk breach', { strategyId: blueprint.id });
          break;
        }

        this.logger.info('Rule triggered', { strategyId: blueprint.id, ruleId: rule.id, action: rule.action, symbol });

        // Track rule hit
        const hit = state.ruleHits.find((h) => h.ruleId === rule.id);
        if (hit) hit.count += 1;

        // Execute trade
        const trade = await this.executor.execute(symbol, rule.action, rule.params, currentPrice, balance);
        if (rule.action === 'BUY' || rule.action === 'SELL') {
          state.openTrades.push(trade);
        } else if (rule.action === 'CLOSE') {
          const open = state.openTrades.find((t) => t.symbol === symbol && t.status === 'OPEN');
          if (open) {
            const closed = await this.executor.closePosition(open, currentPrice);
            state.openTrades = state.openTrades.filter((t) => t.id !== open.id);
            state.closedTrades.push(closed);
            state.dailyLoss += (closed.pnlUsd ?? 0) < 0 ? Math.abs(closed.pnlUsd ?? 0) : 0;
          }
        }

        break; // Only fire highest-priority matched rule per symbol per cycle
      }

      if (state.status === 'halted') break;
    }

    // Record equity snapshot
    state.equityHistory.push({ timestamp: Date.now(), equity: balance });
    if (state.equityHistory.length > 1000) state.equityHistory = state.equityHistory.slice(-1000);

    if (state.status === 'running') state.status = 'idle';
    await this.store.save(state);
    this.logger.info('Strategy cycle complete', { strategyId: blueprint.id });
  }

  private isRiskBreached(state: BotState, blueprint: StrategyBlueprint, balance: number): boolean {
    const rm = blueprint.riskManagement;
    const drawdownPct = ((state.initialBalance - balance) / state.initialBalance) * 100;
    if (drawdownPct >= rm.maxDrawdownPct) return true;
    if ((state.dailyLoss / state.initialBalance) * 100 >= rm.dailyLossLimitPct) return true;
    return false;
  }
}
