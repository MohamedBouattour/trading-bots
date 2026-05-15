import { Module } from '@nestjs/common';
import { DatabaseModule } from '@trading-bots/database';
import { BybitClientModule } from '@trading-bots/bybit-client';
import { AppController } from './app.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { BacktestingController } from './backtesting/backtesting.controller';
import { BotsController } from './bots/bots.controller';
import { LogsController } from './logs/logs.controller';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { TradesController } from './trades/trades.controller';
import { AppService } from './app.service';

@Module({
  imports: [DatabaseModule, BybitClientModule],
  controllers: [
    AppController,
    BotsController,
    BacktestingController,
    AnalyticsController,
    LogsController,
    MarketplaceController,
    TradesController,
  ],
  providers: [AppService],
})
export class AppModule {}
