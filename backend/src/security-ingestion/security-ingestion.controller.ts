import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
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
import {
  RecordFindingLinkRequestDto,
  RecordFindingLinkRequestSchema,
} from './dto/finding-links.dto';
import { SecurityIngestionService } from './security-ingestion.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('security-ingestion')
@Controller('security-ingestion')
export class SecurityIngestionController {
  constructor(private readonly securityIngestionService: SecurityIngestionService) {}

  @Get('findings')
  @ApiOkResponse({ description: 'List durable security findings for the organization.' })
  async listFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query('sourceKind') sourceKind?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.securityIngestionService.listFindings(auth.organizationId, {
      sourceKind: sourceKind?.trim() || undefined,
      status: status?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('findings/:id')
  @ApiOkResponse({ description: 'Get one durable security finding with evidence.' })
  async getFinding(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const finding = await this.securityIngestionService.getFinding(auth.organizationId, id);
    if (!finding) throw new NotFoundException('Finding not found');
    return { finding };
  }

  @Get('findings/:id/evidence')
  @ApiOkResponse({ description: 'List evidence attached to one durable security finding.' })
  async getFindingEvidence(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const evidence = await this.securityIngestionService.getFindingEvidence(
      auth.organizationId,
      id,
    );
    if (!evidence) throw new NotFoundException('Finding not found');
    return { evidence };
  }

  @Get('findings/:id/links')
  @ApiOkResponse({ description: 'List links connected to one durable security finding.' })
  async listFindingLinks(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.securityIngestionService.listFindingLinks(auth.organizationId, id);
    if (!result) throw new NotFoundException('Finding not found');
    return result;
  }

  @Post('findings/:id/links')
  @ApiOkResponse({ description: 'Record a relationship between two durable security findings.' })
  async recordFindingLink(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordFindingLinkRequestSchema))
    body: RecordFindingLinkRequestDto,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const link = await this.securityIngestionService.recordFindingLink(auth.organizationId, {
      fromFindingId: id,
      toFindingId: body.toFindingId,
      relationshipType: body.relationshipType,
      confidence: body.confidence,
      rationale: body.rationale,
      evidenceRefs: body.evidenceRefs,
      createdByAgentRunId: body.createdByAgentRunId,
      createdBy: auth.userId,
      metadata: body.metadata,
    });
    return { link };
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
