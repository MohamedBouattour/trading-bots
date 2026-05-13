import { Controller, Get, Post, Param } from '@nestjs/common';
import { BotService } from './bot.service';

@Controller()
export class AppController {
  constructor(private readonly botService: BotService) {}

  @Get('status')
  getStatus() {
    return { status: 'running', timestamp: new Date().toISOString() };
  }

  @Get('bot/:id/status')
  async getBotStatus(@Param('id') id: string) {
    return this.botService.getBotStatus(id);
  }

  @Post('bot/:id/start')
  async startBot(@Param('id') id: string) {
    await this.botService.startBot(id);
    return { id, status: 'started' };
  }

  @Post('bot/:id/stop')
  async stopBot(@Param('id') id: string) {
    await this.botService.stopBot(id);
    return { id, status: 'stopped' };
  }
}
