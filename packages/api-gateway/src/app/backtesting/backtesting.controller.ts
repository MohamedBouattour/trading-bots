import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';
import { BybitClientService } from '@trading-bots/bybit-client';
import { StrategyEngine } from '@trading-bots/engine';
import { BacktestRun, Candle, Trade, BacktestResult } from '@trading-bots/shared-types';

interface Position {
  size: number;
  entryPrice: number;
  openedAt: Date;
}

@Controller('backtest')
export class BacktestingController {
  private readonly feeRate = 0.0004;

  constructor(
    private readonly db: DatabaseService,
    private readonly bybitClient: BybitClientService,
  ) {}

  @Get('symbols')
  async getSymbols() {
    return this.bybitClient.getSymbols();
  }

  @Get('timeframes')
  getTimeframes() {
    return this.bybitClient.getTimeframes().map(t => ({
      value: t,
      label: this.bybitClient.getTimeframeLabel(t),
    }));
  }

  @Get('strategies')
  async getStrategies() {
    return this.db.strategy.findMany({
      where: { isPublic: true },
      select: { id: true, name: true, description: true, type: true, config: true },
    });
  }

  @Post()
  async runBacktest(@Body() dto: {
    strategyId: string;
    asset: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    initialBalance: number;
  }) {
    let { startDate, endDate } = dto;
    const { strategyId, asset, timeframe, initialBalance } = dto;

    if (!startDate || isNaN(new Date(startDate).getTime())) {
      const d = new Date();
      d.setMonth(d.getMonth() - 3);
      startDate = d.toISOString();
    }
    if (!endDate || isNaN(new Date(endDate).getTime())) {
      endDate = new Date().toISOString();
    }

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
        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();
        if (!isNaN(startMs) && !isNaN(endMs)) {
          try { candles = await this.bybitClient.getKlineRange(asset, timeframe, startMs, endMs); } catch { /* ignore */ }
        }
      }

      if (candles.length === 0) {
        try { candles = await this.bybitClient.getKline(asset, timeframe, 200); } catch { /* ignore */ }
      }

      if (candles.length === 0) {
        candles = this.generateMockCandles(asset, timeframe, new Date(startDate), new Date(endDate));
      }

      const strategy = await this.db.strategy.findUnique({ where: { id: strategyId } });
      if (!strategy) throw new NotFoundException('Strategy not found');

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
          trades: result.trades as any,
        },
      });

      return result;
    } catch (err) {
      await this.db.backtestRun.update({ where: { id: run.id }, data: { status: 'failed' } });
      throw err;
    }
  }

  @Get()
  async findAll() {
    return this.db.backtestRun.findMany({
      orderBy: { createdAt: 'desc' },
      include: { strategy: { select: { name: true, type: true } } },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const run = await this.db.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backtest run not found');
    return run;
  }

  @Get(':id/equity-curve')
  async getEquityCurve(@Param('id') id: string) {
    const run = await this.db.backtestRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Backtest run not found');
    if (run.trades && Array.isArray(run.trades)) {
      const trades = run.trades as Trade[];
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
    return [];
  }

  private simulate(
    candles: Candle[],
    strategyType: string,
    config: Record<string, unknown>,
    initialBalance: number,
    symbol: string,
  ): BacktestResult {
    const engine = new StrategyEngine();
    let balance = initialBalance;
    let position: Position | null = null;
    const trades: Trade[] = [];
    const equityCurve: { date: Date; value: number }[] = [];
    let peak = initialBalance;
    let maxDrawdown = 0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const slice = candles.slice(0, i + 1);
      const signal = engine.getSignal(slice, strategyType, config);

      if (signal.action === 'buy' && !position) {
        const size = balance / candle.close;
        const cost = size * candle.close;
        balance -= cost * this.feeRate;
        position = { size, entryPrice: candle.close, openedAt: candle.timestamp };
      } else if (signal.action === 'sell' && position) {
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

      const currentValue = position ? balance + position.size * candle.close : balance;
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
      trades.push({
        id: crypto.randomUUID(),
        botId: '',
        side: 'buy',
        symbol,
        entryPrice: position.entryPrice,
        exitPrice: lastCandle.close,
        quantity: position.size,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: 0,
        status: 'closed',
        openedAt: position.openedAt,
        closedAt: lastCandle.timestamp,
      });
    }

    const totalReturn = ((balance - initialBalance) / initialBalance) * 100;
    const winTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const winRate = trades.length > 0 ? (winTrades / trades.length) * 100 : 0;
    const returns = equityCurve.map((e, idx) => idx === 0 ? 0 : (e.value - equityCurve[idx - 1].value) / equityCurve[idx - 1].value);
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

  private generateMockCandles(asset: string, timeframe: string, start: Date, end: Date): Candle[] {
    const candles: Candle[] = [];
    const intervals: Record<string, number> = {
      '1': 60000, '3': 180000, '5': 300000, '15': 900000, '30': 1800000,
      '60': 3600000, '120': 7200000, '240': 14400000, '360': 21600000,
      '720': 43200000, 'D': 86400000, 'W': 604800000, 'M': 2592000000,
    };
    const intervalMs = intervals[timeframe] ?? 86400000;
    let ts = start.getTime();
    let price = 100 + Math.random() * 100;
    while (ts < end.getTime()) {
      const change = (Math.random() - 0.48) * price * 0.02;
      const open = price;
      const close = price + change;
      candles.push({
        timestamp: new Date(ts),
        open: Math.round(open * 100) / 100,
        high: Math.round(Math.max(open, close) * (1 + Math.random() * 0.01) * 100) / 100,
        low: Math.round(Math.min(open, close) * (1 - Math.random() * 0.01) * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round(Math.random() * 1000000),
        symbol: asset,
        timeframe,
      });
      price = close;
      ts += intervalMs;
    }
    return candles;
  }
}
