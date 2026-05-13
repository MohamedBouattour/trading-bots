import { Module } from '@nestjs/common';
import { DatabaseModule } from '@trading-bots/database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AppController],
  providers: [AppService, MarketplaceService],
})
export class AppModule {}
