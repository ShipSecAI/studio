import { Module, Global } from '@nestjs/common';
import { ClickHouseClientService } from './clickhouse.client';

@Global()
@Module({
  providers: [ClickHouseClientService],
  exports: [ClickHouseClientService],
})
export class ClickHouseModule {}
