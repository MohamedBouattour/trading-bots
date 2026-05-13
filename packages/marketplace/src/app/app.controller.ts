import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class AppController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('strategies')
  async getStrategies(@Query('sort') sort?: string) {
    return this.marketplaceService.getStrategies(sort);
  }

  @Get('strategies/best-roi')
  async getBestRoi() {
    return this.marketplaceService.getBestRoi();
  }

  @Get('strategies/fastest-growing')
  async getFastestGrowing() {
    return this.marketplaceService.getFastestGrowing();
  }

  @Get('strategies/:id')
  async getStrategy(@Param('id') id: string) {
    return this.marketplaceService.getStrategy(id);
  }

  @Post('publish')
  async publish(@Body() body: { strategyId: string; name: string; description?: string; author?: string }) {
    return this.marketplaceService.publish(body);
  }

  @Post('download/:id')
  async download(@Param('id') id: string) {
    return this.marketplaceService.incrementDownload(id);
  }
}
