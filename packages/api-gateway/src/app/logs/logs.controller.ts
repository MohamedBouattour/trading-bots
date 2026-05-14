import { Controller, Get, Param, Query } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Controller('logs')
export class LogsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll(@Query('botId') botId?: string) {
    const where = botId ? { botId } : {};
    return this.db.botLog.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.db.botLog.findUnique({ where: { id } });
  }
}
