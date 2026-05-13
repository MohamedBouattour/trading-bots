import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { BacktesterService } from './backtester.service';

@Controller('backtest')
export class AppController {
  constructor(private readonly backtesterService: BacktesterService) {}

  @Post()
  runBacktest(
    @Body() body: { strategyId: string; asset: string; timeframe: string; startDate: string; endDate: string; initialBalance: number }
  ) {
    return this.backtesterService.runBacktest(body);
  }

  @Get(':id')
  getBacktestResult(@Param('id') id: string) {
    return this.backtesterService.getBacktestResult(id);
  }

  @Get()
  listBacktestRuns() {
    return this.backtesterService.listBacktestRuns();
  }

  @Get(':id/equity-curve')
  getEquityCurve(@Param('id') id: string) {
    return this.backtesterService.getEquityCurve(id);
  }
}
