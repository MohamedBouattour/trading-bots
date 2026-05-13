import { Module } from '@nestjs/common';
import { DatabaseModule } from '@trading-bots/database';
import { BybitClientModule } from '@trading-bots/bybit-client';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [DatabaseModule, BybitClientModule],
  controllers: [AppController],
  providers: [AppService, AnalyticsService],
})
export class AppModule {}
