import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@trading-bots/database';
import { BybitClientModule } from '@trading-bots/bybit-client';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotService } from './bot.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    BybitClientModule,
  ],
  controllers: [AppController],
  providers: [AppService, BotService],
  exports: [BotService],
})
export class AppModule {}
