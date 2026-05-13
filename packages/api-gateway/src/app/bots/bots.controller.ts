import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';
import { TradingBot } from '@trading-bots/shared-types';

@Controller('bots')
export class BotsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll(): Promise<TradingBot[]> {
    return this.db.tradingBot.findMany();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<TradingBot | null> {
    return this.db.tradingBot.findUnique({ where: { id } });
  }

  @Post()
  async create(@Body() data: {
    name: string;
    userId: string;
    strategyId: string;
    asset: string;
    timeframe: string;
    balance?: number;
    leverage?: number;
    useFutures?: boolean;
  }): Promise<TradingBot> {
    return this.db.tradingBot.create({
      data: {
        ...data,
        balance: data.balance ?? 0,
        leverage: data.leverage ?? 1,
        useFutures: data.useFutures ?? false,
      },
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: Partial<TradingBot>): Promise<TradingBot> {
    return this.db.tradingBot.update({ where: { id }, data });
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<TradingBot> {
    return this.db.tradingBot.delete({ where: { id } });
  }
}
