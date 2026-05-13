import { Global, Module } from '@nestjs/common';
import { BybitClientService } from './bybit-client.service';

@Global()
@Module({
  providers: [BybitClientService],
  exports: [BybitClientService],
})
export class BybitClientModule {}
