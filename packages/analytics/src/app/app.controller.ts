import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AppController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('bot/:id')
  async getBotStats(@Param('id') id: string) {
    return this.analyticsService.getBotStats(id);
  }

  @Get('trades')
  async getTrades(
    @Query('botId') botId?: string,
    @Query('symbol') symbol?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getTrades({ botId, symbol, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get('pnl')
  async getPnl(
    @Query('botId') botId?: string,
    @Query('days') days?: string,
  ) {
    return this.analyticsService.getPnl({ botId, days: days ? parseInt(days, 10) : 30 });
  }

  @Get('market/:symbol')
  async getMarketData(@Param('symbol') symbol: string) {
    return this.analyticsService.getMarketData(symbol);
  }
}
