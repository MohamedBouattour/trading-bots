import { Controller, Get, Param, Query } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('overview')
  async getOverview() {
    const [totalBots, activeBots, totalTrades, trades] = await Promise.all([
      this.db.tradingBot.count(),
      this.db.tradingBot.count({ where: { isActive: true } }),
      this.db.trade.count(),
      this.db.trade.findMany({ where: { status: 'closed' }, orderBy: { closedAt: 'desc' }, take: 50 }),
    ]);

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = trades.length > 0
      ? trades.filter((t) => (t.pnl ?? 0) > 0).length / trades.length
      : 0;
    const bestDay = trades.length > 0
      ? Math.max(...trades.map((t) => t.pnl ?? 0))
      : 0;

    const dailyMap = new Map<string, number>();
    for (const t of trades) {
      if (t.closedAt) {
        const day = t.closedAt.toISOString().split('T')[0];
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + (t.pnl ?? 0));
      }
    }
    const dailyPnl = Array.from(dailyMap.entries())
      .map(([date, pnl]) => ({ date, pnl }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const recentActivity = trades.slice(0, 10).map((t) => ({
      timestamp: t.closedAt ?? t.openedAt,
      message: `${t.side.toUpperCase()} ${t.symbol} ${t.status === 'closed' ? `PnL ${(t.pnl ?? 0).toFixed(2)}` : 'opened'}`,
    }));

    return { totalBots, activeBots, totalTrades, totalPnl, winRate, bestDay, dailyPnl, recentActivity };
  }

  @Get('trades')
  async getTrades(
    @Query('botId') botId?: string,
    @Query('symbol') symbol?: string,
    @Query('status') status?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (botId) where.botId = botId;
    if (symbol) where.symbol = symbol;
    if (status) where.status = status;
    return this.db.trade.findMany({ where, orderBy: { openedAt: 'desc' }, take: 200 });
  }

  @Get('bot/:id')
  async getBotStats(@Param('id') id: string) {
    const trades = await this.db.trade.findMany({ where: { botId: id } });
    const closedTrades = trades.filter((t) => t.status === 'closed');
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = closedTrades.length > 0
      ? closedTrades.filter((t) => (t.pnl ?? 0) > 0).length / closedTrades.length
      : 0;
    return { totalTrades: trades.length, closedTrades: closedTrades.length, totalPnl, winRate };
  }

  @Get('pnl')
  async getPnl(@Query('days') days?: string) {
    const numDays = days ? parseInt(days, 10) : 30;
    const since = new Date();
    since.setDate(since.getDate() - numDays);
    const trades = await this.db.trade.findMany({
      where: { closedAt: { gte: since }, status: 'closed' },
      orderBy: { closedAt: 'asc' },
    });
    const dailyMap = new Map<string, number>();
    for (const t of trades) {
      if (t.closedAt) {
        const day = t.closedAt.toISOString().split('T')[0];
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + (t.pnl ?? 0));
      }
    }
    return Array.from(dailyMap.entries())
      .map(([date, pnl]) => ({ date, pnl }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  @Get('market/:symbol')
  async getMarketData(@Param('symbol') symbol: string) {
    const candles = await this.db.candle.findMany({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
    if (candles.length === 0) return null;
    const latest = candles[0];
    return {
      symbol,
      price: latest.close,
      change: candles.length > 1 ? ((latest.close - candles[1].close) / candles[1].close) * 100 : 0,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      volume: candles.reduce((s, c) => s + c.volume, 0),
      candles: candles.reverse(),
    };
  }

  @Get('performance')
  async getPerformance(@Query('botId') botId?: string) {
    const where = botId ? { botId } : {};
    const trades = await this.db.trade.findMany({ where });
    const closedTrades = trades.filter((t) => t.status === 'closed');
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const winRate = closedTrades.length > 0
      ? closedTrades.filter((t) => (t.pnl ?? 0) > 0).length / closedTrades.length
      : 0;
    return { totalTrades: trades.length, closedTrades: closedTrades.length, totalPnl, winRate };
  }

  @Get('stats')
  async getStats() {
    const [botCount, tradeCount, activeBots] = await Promise.all([
      this.db.tradingBot.count(),
      this.db.trade.count(),
      this.db.tradingBot.count({ where: { isActive: true } }),
    ]);
    return { botCount, tradeCount, activeBots };
  }
}
