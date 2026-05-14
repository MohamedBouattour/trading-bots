import { Controller, Get, Param, Query } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Controller('trades')
export class TradesController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll(
    @Query('botId') botId?: string,
    @Query('symbol') symbol?: string,
    @Query('status') status?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (botId) where.botId = botId;
    if (symbol) where.symbol = symbol;
    if (status) where.status = status;
    return this.db.trade.findMany({ where, orderBy: { openedAt: 'desc' } });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.db.trade.findUnique({ where: { id } });
  }
}
