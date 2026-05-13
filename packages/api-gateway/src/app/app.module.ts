import { Module } from '@nestjs/common';
import { DatabaseModule } from '@trading-bots/database';
import { AppController } from './app.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { BacktestingController } from './backtesting/backtesting.controller';
import { BotsController } from './bots/bots.controller';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { AppService } from './app.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    AppController,
    BotsController,
    BacktestingController,
    AnalyticsController,
    MarketplaceController,
  ],
  providers: [AppService],
})
export class AppModule {}
