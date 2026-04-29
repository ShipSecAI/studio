import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { InternalOnly } from '../common/guards/internal-only.guard';
import {
  PersistSecurityIngestionBatchRequestDto,
  PersistSecurityIngestionBatchRequestSchema,
  PersistSecurityIngestionBatchResponseDto,
} from './dto/ingest-batch.dto';
import { SecurityIngestionService } from './security-ingestion.service';

@ApiTags('security-ingestion')
@Controller('security-ingestion/internal')
export class SecurityIngestionController {
  constructor(private readonly securityIngestionService: SecurityIngestionService) {}

  @Post('batches')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PersistSecurityIngestionBatchResponseDto })
  async persistBatch(
    @Headers('x-organization-id') organizationId: string,
    @Body(new ZodValidationPipe(PersistSecurityIngestionBatchRequestSchema))
    body: PersistSecurityIngestionBatchRequestDto,
  ) {
    return this.securityIngestionService.persistBatch(organizationId, body.batch);
  }
}
