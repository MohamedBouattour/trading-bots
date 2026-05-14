import { Global, Module } from '@nestjs/common';
import { BybitClientService } from './bybit-client.service.js';

@Global()
@Module({
  providers: [BybitClientService],
  exports: [BybitClientService],
})
export class BybitClientModule {}
