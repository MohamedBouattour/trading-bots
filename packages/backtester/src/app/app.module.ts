import { Module } from '@nestjs/common';
import { DatabaseModule } from '@trading-bots/database';
import { BybitClientModule } from '@trading-bots/bybit-client';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BacktesterService } from './backtester.service';

@Module({
  imports: [DatabaseModule, BybitClientModule],
  controllers: [AppController],
  providers: [AppService, BacktesterService],
})
export class AppModule {}
