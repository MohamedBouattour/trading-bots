import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';
import { BybitClientService } from '@trading-bots/bybit-client';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bybit: BybitClientService,
  ) {}

  async getOverview() {
    const [bots, trades, logs, pnlResult] = await Promise.all([
      this.db.tradingBot.findMany(),
      this.db.trade.findMany(),
      this.db.botLog.groupBy({
        by: ['level'],
        _count: true,
      }),
      this.db.trade.aggregate({
        _sum: { pnl: true },
        _avg: { pnlPercent: true },
      }),
    ]);

    const totalTrades = trades.length;
    const closedTrades = trades.filter(t => t.status === 'closed');
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    const logCounts: Record<string, number> = {};
    for (const entry of logs) {
      logCounts[entry.level] = entry._count;
    }

    return {
      totalBots: bots.length,
      activeBots: bots.filter(b => b.isActive).length,
      totalTrades,
      openTrades: trades.filter(t => t.status === 'open').length,
      totalPnl: pnlResult._sum.pnl ?? 0,
      avgPnlPercent: pnlResult._avg.pnlPercent ?? 0,
      winRate,
      logCounts,
    };
  }

  async getBotStats(id: string) {
    const bot = await this.db.tradingBot.findUnique({
      where: { id },
      include: {
        trades: true,
        logs: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });

    if (!bot) {
      return null;
    }

    const closedTrades = bot.trades.filter(t => t.status === 'closed');
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl ?? 0) < 0);
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalVolume = bot.trades.reduce((sum, t) => sum + t.quantity * t.entryPrice, 0);

    const logLevels: Record<string, number> = {};
    for (const log of bot.logs) {
      logLevels[log.level] = (logLevels[log.level] ?? 0) + 1;
    }

    return {
      bot: {
        id: bot.id,
        name: bot.name,
        asset: bot.asset,
        timeframe: bot.timeframe,
        isActive: bot.isActive,
        balance: bot.balance,
        createdAt: bot.createdAt,
      },
      stats: {
        totalTrades: bot.trades.length,
        openTrades: bot.trades.filter(t => t.status === 'open').length,
        closedTrades: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate,
        totalPnl,
        avgPnl: closedTrades.length > 0 ? totalPnl / closedTrades.length : 0,
        totalVolume,
      },
      logCounts: logLevels,
      recentLogs: bot.logs.slice(0, 50),
    };
  }

  async getTrades(filters: { botId?: string; symbol?: string; status?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.botId) where.botId = filters.botId;
    if (filters.symbol) where.symbol = filters.symbol;
    if (filters.status) where.status = filters.status;

    return this.db.trade.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      take: filters.limit ?? 100,
      include: { bot: { select: { name: true, asset: true } } },
    });
  }

  async getPnl(filters: { botId?: string; days: number }) {
    const since = new Date();
    since.setDate(since.getDate() - filters.days);

    const where: Record<string, unknown> = {
      status: 'closed',
      closedAt: { gte: since },
    };
    if (filters.botId) where.botId = filters.botId;

    const trades = await this.db.trade.findMany({
      where,
      orderBy: { closedAt: 'asc' },
    });

    const dailyPnl: Record<string, { date: string; pnl: number; trades: number }> = {};
    for (const trade of trades) {
      if (!trade.closedAt) continue;
      const key = trade.closedAt.toISOString().slice(0, 10);
      if (!dailyPnl[key]) {
        dailyPnl[key] = { date: key, pnl: 0, trades: 0 };
      }
      dailyPnl[key].pnl += trade.pnl ?? 0;
      dailyPnl[key].trades += 1;
    }

    const cumulative = Object.values(dailyPnl).sort((a, b) => a.date.localeCompare(b.date));
    let runningTotal = 0;
    for (const entry of cumulative) {
      runningTotal += entry.pnl;
      entry.pnl = Math.round(runningTotal * 100) / 100;
    }

    return cumulative;
  }

  async getMarketData(symbol: string) {
    const tickers = await this.bybit.getTickers(symbol);
    return tickers;
  }
}
