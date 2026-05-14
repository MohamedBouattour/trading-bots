import { Controller, Get, Param, Query } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly db: DatabaseService) {}

  @Get('strategies')
  async findAll(@Query('sort') sort?: string) {
    const orderBy: Record<string, unknown>[] = [{ isPublished: 'desc' }];

    switch (sort) {
      case 'monthlyROI':
        orderBy.push({ monthlyROI: 'desc' });
        break;
      case 'totalROI':
        orderBy.push({ totalROI: 'desc' });
        break;
      case 'popularity':
        orderBy.push({ popularity: 'desc' });
        break;
      case 'fastestGrowing':
        orderBy.push({ fastestGrowing: 'desc' }, { downloads: 'desc' });
        break;
      default:
        orderBy.push({ downloads: 'desc' });
    }

    const all = await this.db.marketplaceStrategy.findMany({
      where: { isPublished: true },
      orderBy,
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });

    const bestRoi = await this.db.marketplaceStrategy.findMany({
      where: { isPublished: true },
      orderBy: { totalROI: 'desc' },
      take: 6,
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });

    const fastestGrowing = await this.db.marketplaceStrategy.findMany({
      where: { isPublished: true, fastestGrowing: true },
      orderBy: { downloads: 'desc' },
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });

    return { all, bestRoi, fastestGrowing };
  }

  @Get('strategies/best-roi')
  async findBestRoi() {
    return this.db.marketplaceStrategy.findMany({
      where: { isPublished: true },
      orderBy: { totalROI: 'desc' },
      take: 10,
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });
  }

  @Get('strategies/fastest-growing')
  async findFastestGrowing() {
    return this.db.marketplaceStrategy.findMany({
      where: { isPublished: true, fastestGrowing: true },
      orderBy: { downloads: 'desc' },
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });
  }

  @Get('strategies/:id')
  async findOne(@Param('id') id: string) {
    return this.db.marketplaceStrategy.findUnique({
      where: { id },
      include: {
        strategy: {
          select: { type: true, config: true, user: { select: { name: true } } },
        },
      },
    });
  }
}
