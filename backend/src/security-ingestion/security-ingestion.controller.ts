import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { InternalOnly } from '../common/guards/internal-only.guard';
import {
  PersistSecurityIngestionBatchRequestDto,
  PersistSecurityIngestionBatchRequestSchema,
  PersistSecurityIngestionBatchResponseDto,
} from './dto/ingest-batch.dto';
import { SecurityIngestionService } from './security-ingestion.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('security-ingestion')
@Controller('security-ingestion')
export class SecurityIngestionController {
  constructor(private readonly securityIngestionService: SecurityIngestionService) {}

  @Get('findings')
  @ApiOkResponse({ description: 'List durable security finding chains for the organization.' })
  async listFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query('sourceKind') sourceKind?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.securityIngestionService.listFindingChains(auth.organizationId, {
      sourceKind: sourceKind?.trim() || undefined,
      status: status?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('internal/batches')
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
