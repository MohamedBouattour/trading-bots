import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly db: DatabaseService) {}

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
