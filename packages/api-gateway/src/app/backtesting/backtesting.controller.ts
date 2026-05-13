import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';
import { BacktestRun } from '@trading-bots/shared-types';

@Controller('backtesting')
export class BacktestingController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll(): Promise<BacktestRun[]> {
    return this.db.backtestRun.findMany();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<BacktestRun | null> {
    return this.db.backtestRun.findUnique({ where: { id } });
  }

  @Post()
  async create(@Body() data: {
    strategyId: string;
    asset: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    initialBalance: number;
  }): Promise<BacktestRun> {
    return this.db.backtestRun.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        status: 'running',
      },
    });
  }
}
