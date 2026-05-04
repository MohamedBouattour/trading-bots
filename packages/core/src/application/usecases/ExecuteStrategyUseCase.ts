import { StrategyBlueprint } from "../../domain/models/StrategyBlueprint";
import { BotState } from "../../domain/models/BotState";
import { TradeRecord } from "../../domain/models/TradeRecord";
import { IndicatorService } from "../../domain/services/IndicatorService";
import { ConditionEvaluator } from "../../domain/services/ConditionEvaluator";
import { IMarketDataProvider } from "../ports/IMarketDataProvider";
import { ITradeExecutor } from "../ports/ITradeExecutor";
import { IStateStore } from "../ports/IStateStore";
import { ILogger } from "../ports/ILogger";
import { Candle } from "../../domain/models/Candle";
import { Timeframe } from "../../domain/models/StrategyBlueprint";

/**
 * Generic strategy executor.
 *
 * This use case interprets a StrategyBlueprint JSON at runtime:
 *  1. Fetches candles for each declared indicator
 *  2. Computes indicator values (IndicatorService)
 *  3. Evaluates rule conditions in priority order (ConditionEvaluator)
 *  4. Fires the action of the first matched rule
 *  5. Persists state
 *
 * Zero strategy-specific logic lives here.
 * To add a new strategy, drop a JSON blueprint in /strategies.
 * To add a new indicator, add a case in IndicatorService.compute().
 */
export class ExecuteStrategyUseCase {
  constructor(
    private readonly market: IMarketDataProvider,
    private readonly executor: ITradeExecutor,
    private readonly stateStore: IStateStore,
    private readonly logger: ILogger
  ) {}

  async run(blueprint: StrategyBlueprint): Promise<void> {
    const state = await this.loadOrInitState(blueprint);

    if (state.halted) {
      this.logger.warn(`[${blueprint.id}] Bot halted: ${state.haltReason}`);
      return;
    }

    const equity = await this.market.getTotalEquity();
    const balance = await this.market.getAvailableBalance();

    // Risk guard: max drawdown
    const drawdown = this.calcDrawdown(state, equity);
    if (drawdown >= blueprint.riskManagement.maxDrawdownPct) {
      state.halted = true;
      state.haltReason = `Max drawdown ${drawdown.toFixed(1)}% exceeded (limit: ${blueprint.riskManagement.maxDrawdownPct}%)`;
      this.logger.error(`[${blueprint.id}] HALTED — ${state.haltReason}`);
      await this.stateStore.save(state);
      return;
    }

    // Risk guard: daily loss limit
    const dailyLossLimit = equity * (blueprint.riskManagement.dailyLossLimitPct / 100);
    if (state.dailyPnl <= -dailyLossLimit) {
      state.halted = true;
      state.haltReason = `Daily loss limit reached (${state.dailyPnl.toFixed(2)} USDT)`;
      this.logger.error(`[${blueprint.id}] HALTED — ${state.haltReason}`);
      await this.stateStore.save(state);
      return;
    }

    for (const symbol of blueprint.symbols) {
      await this.processSymbol(symbol, blueprint, state, balance, equity);
    }

    state.lastRunAt = Date.now();
    state.runCount++;
    state.equityHistory.push({ ts: Date.now(), equity });
    state.maxDrawdown = Math.max(state.maxDrawdown, drawdown);

    await this.stateStore.save(state);
    this.logger.info(`[${blueprint.id}] Cycle #${state.runCount} complete. Equity: ${equity.toFixed(2)} USDT`);
  }

  private async processSymbol(
    symbol: string,
    blueprint: StrategyBlueprint,
    state: BotState,
    balance: number,
    equity: number
  ): Promise<void> {
    const indicatorValues = new Map<string, number>();
    const candleCache = new Map<string, Candle[]>();

    // Compute all declared indicators
    for (const decl of blueprint.indicators) {
      const key = `${symbol}_${decl.timeframe}`;
      if (!candleCache.has(key)) {
        const candles = await this.market.getCandles(symbol, decl.timeframe as Timeframe, 200);
        candleCache.set(key, candles);
      }
      const candles = candleCache.get(key)!;
      const value = IndicatorService.compute(decl, candles);
      indicatorValues.set(decl.id, value);
      this.logger.debug(`[${blueprint.id}] ${decl.id} = ${value.toFixed(4)}`);
    }

    const currentPrice = await this.market.getCurrentPrice(symbol);
    const priceCtx = {
      close: currentPrice,
      open: currentPrice,
      high: currentPrice,
      low: currentPrice,
    };

    // Evaluate rules in ascending priority order (lower number = higher priority)
    const sortedRules = [...blueprint.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const triggered = ConditionEvaluator.evaluate(rule.conditionGroup, indicatorValues, priceCtx);

      if (!triggered) continue;

      this.logger.info(`[${blueprint.id}] Rule "${rule.name}" → ${rule.action} ${symbol} @ ${currentPrice}`);

      if (rule.action === "HOLD") break;

      if (rule.action === "CLOSE_ALL") {
        state.openTrades
          .filter((t) => t.symbol === symbol && t.status === "OPEN")
          .forEach((t) => { t.status = "CLOSED"; t.closedAt = Date.now(); });
        state.closedTrades.push(...state.openTrades.filter((t) => t.symbol === symbol && t.status === "CLOSED"));
        state.openTrades = state.openTrades.filter((t) => !(t.symbol === symbol && t.status === "CLOSED"));
        break;
      }

      if (rule.action === "BUY" || rule.action === "SELL") {
        const params = rule.params ?? {};
        let sizeUSDT = 0;
        const mode = params.sizeMode ?? "pct_balance";

        if (mode === "fixed") {
          sizeUSDT = params.sizeValue ?? 50;
        } else if (mode === "pct_balance") {
          sizeUSDT = balance * ((params.sizeValue ?? 5) / 100);
        }

        // Cap to max position % of total equity
        const maxSize = equity * (blueprint.riskManagement.maxPositionPct / 100);
        sizeUSDT = Math.min(sizeUSDT, maxSize);

        if (sizeUSDT < 5) {
          this.logger.warn(`[${blueprint.id}] Order size ${sizeUSDT.toFixed(2)} USDT below minimum — skipping`);
          break;
        }

        if (params.leverage) {
          await this.executor.setLeverage(symbol, params.leverage);
        }

        const result = await this.executor.executeMarketOrder(symbol, rule.action, sizeUSDT);

        if (result.status === "FILLED") {
          const trade: TradeRecord = {
            id: result.orderId,
            strategyId: blueprint.id,
            symbol,
            direction: rule.action,
            entryPrice: result.executedPrice,
            quantity: result.executedQty,
            sizeUSDT,
            openedAt: Date.now(),
            status: "OPEN",
            ruleId: rule.id,
            tags: blueprint.metadata.tags,
          };
          state.openTrades.push(trade);
          this.logger.success(
            `[${blueprint.id}] ✅ ${rule.action} ${symbol} | qty: ${result.executedQty} | price: ${result.executedPrice} | size: ${sizeUSDT.toFixed(2)} USDT`
          );
        } else {
          this.logger.error(`[${blueprint.id}] Order ${result.status} for ${symbol}`);
        }
      }

      break; // first matched rule wins per symbol per cycle
    }
  }

  private async loadOrInitState(blueprint: StrategyBlueprint): Promise<BotState> {
    const existing = await this.stateStore.load(blueprint.id);
    if (existing) return existing;
    return {
      strategyId: blueprint.id,
      lastRunAt: 0,
      runCount: 0,
      equityHistory: [],
      openTrades: [],
      closedTrades: [],
      dailyPnl: 0,
      totalPnl: 0,
      maxDrawdown: 0,
      halted: false,
    };
  }

  private calcDrawdown(state: BotState, currentEquity: number): number {
    if (state.equityHistory.length === 0) return 0;
    const peak = Math.max(...state.equityHistory.map((e) => e.equity));
    if (peak === 0) return 0;
    return ((peak - currentEquity) / peak) * 100;
  }
}
