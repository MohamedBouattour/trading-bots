import { Controller, Get, Param } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';
import { MarketplaceStrategy } from '@trading-bots/shared-types';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async findAll(): Promise<MarketplaceStrategy[]> {
    return this.db.marketplaceStrategy.findMany({ where: { isPublished: true } });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<MarketplaceStrategy | null> {
    return this.db.marketplaceStrategy.findUnique({ where: { id } });
  }
}
