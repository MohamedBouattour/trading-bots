import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@trading-bots/database';

@Injectable()
export class MarketplaceService {
  constructor(private readonly db: DatabaseService) {}

  async getStrategies(sort?: string) {
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

    return this.db.marketplaceStrategy.findMany({
      where: { isPublished: true },
      orderBy,
      include: {
        strategy: {
          select: { type: true, config: true },
        },
      },
    });
  }

  async getBestRoi() {
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

  async getFastestGrowing() {
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

  async getStrategy(id: string) {
    const strategy = await this.db.marketplaceStrategy.findUnique({
      where: { id },
      include: {
        strategy: {
          select: { type: true, config: true, user: { select: { name: true } } },
        },
      },
    });

    if (!strategy) {
      throw new NotFoundException(`Strategy ${id} not found`);
    }

    return strategy;
  }

  async publish(data: { strategyId: string; name: string; description?: string; author?: string }) {
    const strategy = await this.db.strategy.findUnique({
      where: { id: data.strategyId },
    });

    if (!strategy) {
      throw new BadRequestException('Strategy not found');
    }

    const existing = await this.db.marketplaceStrategy.findUnique({
      where: { strategyId: data.strategyId },
    });

    if (existing) {
      if (existing.isPublished) {
        throw new BadRequestException('Strategy already published');
      }
      return this.db.marketplaceStrategy.update({
        where: { id: existing.id },
        data: { isPublished: true, name: data.name, description: data.description, author: data.author },
      });
    }

    return this.db.marketplaceStrategy.create({
      data: {
        strategyId: data.strategyId,
        name: data.name,
        description: data.description,
        author: data.author,
        isPublished: true,
      },
    });
  }

  async incrementDownload(id: string) {
    const strategy = await this.db.marketplaceStrategy.findUnique({
      where: { id },
    });

    if (!strategy) {
      throw new NotFoundException(`Strategy ${id} not found`);
    }

    return this.db.marketplaceStrategy.update({
      where: { id },
      data: {
        downloads: { increment: 1 },
        popularity: { increment: 1 },
      },
    });
  }
}
