import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '@trading-bots/database';
import { BybitClientService } from '@trading-bots/bybit-client';
import { Candle, Trade, BacktestResult, StrategyType } from '@trading-bots/shared-types';

interface Position {
  size: number;
  entryPrice: number;
  openedAt: Date;
}

@Injectable()
export class BacktesterService {
  private readonly feeRate = 0.0004;

  constructor(
    private readonly db: DatabaseService,
    private readonly bybitClient: BybitClientService,
  ) {}

  async runBacktest(dto: {
    strategyId: string;
    asset: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    initialBalance: number;
  }): Promise<BacktestResult> {
    const { strategyId, asset, timeframe, startDate, endDate, initialBalance } = dto;

    const run = await this.db.backtestRun.create({
      data: {
        strategyId,
        asset,
        timeframe,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        initialBalance,
        status: 'running',
      },
    });

    try {
      let candles: Candle[] = await this.db.candle.findMany({
        where: {
          symbol: asset,
          timeframe,
          timestamp: { gte: new Date(startDate), lte: new Date(endDate) },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (candles.length === 0) {
        candles = await this.bybitClient.getKline(asset, timeframe, 200);
      }

      if (candles.length === 0) {
        throw new Error('No candle data available for the specified parameters');
      }

      const strategy = await this.db.strategy.findUnique({ where: { id: strategyId } });
      if (!strategy) {
        throw new NotFoundException('Strategy not found');
      }

      const result = this.simulate(candles, strategy.type, strategy.config as Record<string, unknown>, initialBalance, asset);

      await this.db.backtestRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          finalBalance: initialBalance + result.trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
          totalReturn: result.totalReturn,
          sharpeRatio: result.sharpeRatio,
          maxDrawdown: result.maxDrawdown,
          totalTrades: result.totalTrades,
          winRate: result.winRate,
          trades: result.trades as unknown as Prisma.InputJsonValue,
        },
      });

      return result;
    } catch (err) {
      await this.db.backtestRun.update({
        where: { id: run.id },
        data: { status: 'failed' },
      });
      throw err;
    }
  }

  async getBacktestResult(id: string) {
    const run = await this.db.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backtest run not found');
    return run;
  }

  async listBacktestRuns() {
    return this.db.backtestRun.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getEquityCurve(id: string) {
    const run = await this.db.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backtest run not found');
    if (run.trades && Array.isArray(run.trades)) {
      return this.calculateEquityCurve(run);
    }
    return [];
  }

  private simulate(
    candles: Candle[],
    strategyType: string,
    config: Record<string, unknown>,
    initialBalance: number,
    symbol: string,
  ): BacktestResult {
    let balance = initialBalance;
    let position: Position | null = null;
    const trades: Trade[] = [];
    const equityCurve: { date: Date; value: number }[] = [];
    let peak = initialBalance;
    let maxDrawdown = 0;

    const type = strategyType as StrategyType;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const slice = candles.slice(0, i + 1);

      let signal: 'buy' | 'sell' | 'hold' = 'hold';

      if (type === 'ma_crossover') {
        const fastPeriod = (config.fastPeriod as number) ?? 10;
        const slowPeriod = (config.slowPeriod as number) ?? 30;
        if (i >= slowPeriod) {
          const fastSma = this.sma(candles, i, fastPeriod);
          const slowSma = this.sma(candles, i, slowPeriod);
          const prevFast = this.sma(candles, i - 1, fastPeriod);
          const prevSlow = this.sma(candles, i - 1, slowPeriod);
          if (prevFast <= prevSlow && fastSma > slowSma) signal = 'buy';
          else if (prevFast >= prevSlow && fastSma < slowSma) signal = 'sell';
        }
      } else if (type === 'rsi') {
        const rsiPeriod = (config.rsiPeriod as number) ?? 14;
        const oversold = (config.oversold as number) ?? 30;
        const overbought = (config.overbought as number) ?? 70;
        if (i >= rsiPeriod + 1) {
          const rsi = this.bybitClient.calculateRSI(slice, rsiPeriod);
          const prevRsi = this.bybitClient.calculateRSI(candles.slice(0, i), rsiPeriod);
          if (prevRsi <= oversold && rsi > oversold) signal = 'buy';
          else if (prevRsi >= overbought && rsi < overbought) signal = 'sell';
        }
      }

      if (signal === 'buy' && !position) {
        const size = balance / candle.close;
        const cost = size * candle.close;
        balance -= cost * this.feeRate;
        position = { size, entryPrice: candle.close, openedAt: candle.timestamp };
      } else if (signal === 'sell' && position) {
        const value = position.size * candle.close;
        balance += value - value * this.feeRate;
        const pnl = (candle.close - position.entryPrice) * position.size;
        const pnlPercent = ((candle.close - position.entryPrice) / position.entryPrice) * 100;
        trades.push({
          id: crypto.randomUUID(),
          botId: '',
          side: 'buy',
          symbol,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          quantity: position.size,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          status: 'closed',
          openedAt: position.openedAt,
          closedAt: candle.timestamp,
        });
        position = null;
      }

      const currentValue = position
        ? balance + position.size * candle.close
        : balance;

      equityCurve.push({ date: candle.timestamp, value: Math.round(currentValue * 100) / 100 });

      if (currentValue > peak) peak = currentValue;
      const drawdown = ((peak - currentValue) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    if (position) {
      const lastCandle = candles[candles.length - 1];
      const value = position.size * lastCandle.close;
      balance += value - value * this.feeRate;
      const pnl = (lastCandle.close - position.entryPrice) * position.size;
      const pnlPercent = ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100;
      trades.push({
        id: crypto.randomUUID(),
        botId: '',
        side: 'buy',
        symbol,
        entryPrice: position.entryPrice,
        exitPrice: lastCandle.close,
        quantity: position.size,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        status: 'closed',
        openedAt: position.openedAt,
        closedAt: lastCandle.timestamp,
      });
    }

    const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const winTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const winRate = trades.length > 0 ? (winTrades / trades.length) * 100 : 0;

    const returns = equityCurve.map((e, idx) => {
      if (idx === 0) return 0;
      return (e.value - equityCurve[idx - 1].value) / equityCurve[idx - 1].value;
    });
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

    return {
      totalReturn: Math.round(totalReturn * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      totalTrades: trades.length,
      winRate: Math.round(winRate * 100) / 100,
      trades,
      equityCurve,
    };
  }

  private calculateEquityCurve(run: {
    initialBalance: number;
    trades?: unknown;
  }): { date: Date; value: number }[] {
    const trades = (run.trades as Trade[]) || [];
    const curve: { date: Date; value: number }[] = [];
    let balance = run.initialBalance;
    curve.push({ date: new Date(0), value: balance });
    for (const trade of trades) {
      balance += trade.pnl ?? 0;
      if (trade.closedAt) {
        curve.push({ date: trade.closedAt, value: Math.round(balance * 100) / 100 });
      }
    }
    return curve;
  }

  private sma(candles: Candle[], index: number, period: number): number {
    const slice = candles.slice(index - period + 1, index + 1);
    return slice.reduce((sum, c) => sum + c.close, 0) / period;
  }
}
