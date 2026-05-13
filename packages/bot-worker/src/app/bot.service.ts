import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '@trading-bots/database';
import { BybitClientService } from '@trading-bots/bybit-client';
import { Candle, BotDecision } from '@trading-bots/shared-types';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bybit: BybitClientService,
  ) {}

  @Cron('*/5 * * * *')
  async executeBots() {
    this.logger.log('Starting bot execution cycle');
    try {
      const bots = await this.db.tradingBot.findMany({ where: { isActive: true } });
      this.logger.log(`Found ${bots.length} active bots`);
      for (const bot of bots) {
        await this.processBot(bot).catch((err) => {
          this.logger.error(`Bot ${bot.id} error: ${err.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`Cycle error: ${err.message}`);
    }
  }

  private async processBot(bot: any) {
    const apiKey = process.env.API_KEY || '';
    const secretKey = process.env.SECRET_KEY || '';
    if (!apiKey || !secretKey) {
      this.logger.warn(`Bot ${bot.id}: no API keys`);
      return;
    }
    this.bybit.configure(apiKey, secretKey, true);

    const candles = await this.bybit.getKline(bot.asset, bot.timeframe, 100);
    if (!candles || candles.length < 30) {
      this.logger.warn(`Bot ${bot.id}: insufficient candles`);
      return;
    }

    const closes = candles.map(c => c.close);
    const decision = this.evaluateStrategy(bot.strategy, candles, closes);

    await this.db.botLog.create({
      data: {
        botId: bot.id,
        level: 'info',
        message: `Decision: ${decision.action} (${decision.reason})`,
        metadata: decision as any,
      },
    });

    if (decision.action === 'hold') {
      this.logger.log(`Bot ${bot.id}: HOLD - ${decision.reason}`);
      return;
    }

    const side = decision.action === 'buy' ? 'Buy' : 'Sell';
    const qty = (bot.balance / candles[candles.length - 1].close * 0.95).toFixed(6);

    try {
      const order = await this.bybit.placeOrder(bot.asset, side, 'Market', qty);
      this.logger.log(`Bot ${bot.id}: ${side} ${qty} ${bot.asset} - ${order.retMsg}`);
      await this.db.trade.create({
        data: {
          botId: bot.id,
          side: decision.action,
          symbol: bot.asset,
          entryPrice: candles[candles.length - 1].close,
          quantity: parseFloat(qty),
          status: 'open',
        },
      });
    } catch (err: any) {
      this.logger.error(`Bot ${bot.id} order failed: ${err.message}`);
      await this.db.botLog.create({
        data: {
          botId: bot.id,
          level: 'error',
          message: `Order failed: ${err.message}`,
        },
      });
    }
  }

  private evaluateStrategy(strategy: any, candles: Candle[], closes: number[]): BotDecision {
    const type = strategy?.type || 'ma_crossover';
    switch (type) {
      case 'ma_crossover': return this.maCrossover(closes);
      case 'rsi': return this.rsiStrategy(candles);
      case 'bollinger': return this.bollinger(closes);
      default: return { action: 'hold', confidence: 0, reason: 'Unknown strategy', timestamp: new Date() };
    }
  }

  private sma(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private maCrossover(closes: number[]): BotDecision {
    const sma10 = this.sma(closes, 10);
    const sma30 = this.sma(closes, 30);
    const prev10 = this.sma(closes.slice(0, -1), 10);
    const prev30 = this.sma(closes.slice(0, -1), 30);
    if (closes.length >= 31 && prev10 <= prev30 && sma10 > sma30) {
      return { action: 'buy', confidence: 80, reason: 'Golden cross', timestamp: new Date() };
    }
    if (closes.length >= 31 && prev10 >= prev30 && sma10 < sma30) {
      return { action: 'sell', confidence: 80, reason: 'Death cross', timestamp: new Date() };
    }
    return { action: 'hold', confidence: 50, reason: 'No crossover', timestamp: new Date() };
  }

  private rsiStrategy(candles: Candle[]): BotDecision {
    const rsi = this.bybit.calculateRSI(candles, 14);
    if (rsi < 30) return { action: 'buy', confidence: 90, reason: `RSI oversold: ${rsi.toFixed(2)}`, timestamp: new Date() };
    if (rsi > 70) return { action: 'sell', confidence: 90, reason: `RSI overbought: ${rsi.toFixed(2)}`, timestamp: new Date() };
    return { action: 'hold', confidence: 50, reason: `RSI neutral: ${rsi.toFixed(2)}`, timestamp: new Date() };
  }

  private bollinger(closes: number[]): BotDecision {
    const period = 20;
    if (closes.length < period) return { action: 'hold', confidence: 0, reason: 'Not enough data', timestamp: new Date() };
    const sma = this.sma(closes, period);
    const sqDiffs = closes.slice(-period).map(p => (p - sma) ** 2);
    const std = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / period);
    const current = closes[closes.length - 1];
    if (current <= sma - 2 * std) return { action: 'buy', confidence: 85, reason: 'Price at lower band', timestamp: new Date() };
    if (current >= sma + 2 * std) return { action: 'sell', confidence: 85, reason: 'Price at upper band', timestamp: new Date() };
    return { action: 'hold', confidence: 50, reason: 'Price within bands', timestamp: new Date() };
  }

  async startBot(botId: string) {
    await this.db.tradingBot.update({ where: { id: botId }, data: { isActive: true } });
    await this.db.botLog.create({ data: { botId, level: 'info', message: 'Bot started' } });
  }

  async stopBot(botId: string) {
    await this.db.tradingBot.update({ where: { id: botId }, data: { isActive: false } });
    await this.db.botLog.create({ data: { botId, level: 'info', message: 'Bot stopped' } });
  }

  async getBotStatus(botId: string) {
    return this.db.tradingBot.findUnique({ where: { id: botId }, include: { trades: { take: 10, orderBy: { openedAt: 'desc' } }, logs: { take: 20, orderBy: { createdAt: 'desc' } } } });
  }
}
