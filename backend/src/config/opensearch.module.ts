import { Module, Global } from '@nestjs/common';
import { OpenSearchClient } from './opensearch.client';

@Global()
@Module({
  providers: [OpenSearchClient],
  exports: [OpenSearchClient],
})
export class OpenSearchModule {}
