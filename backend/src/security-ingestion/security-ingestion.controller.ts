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
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { InternalOnly } from '../common/guards/internal-only.guard';
import {
  PersistSecurityIngestionBatchRequestDto,
  PersistSecurityIngestionBatchRequestSchema,
  PersistSecurityIngestionBatchResponseDto,
} from './dto/ingest-batch.dto';
import {
  RecordFindingAssessmentRequestDto,
  RecordFindingAssessmentRequestSchema,
} from './dto/finding-assessments.dto';
import {
  RecordFindingLinkRequestDto,
  RecordFindingLinkRequestSchema,
} from './dto/finding-links.dto';
import {
  RecordThreatStoryRequestDto,
  RecordThreatStoryRequestSchema,
} from './dto/threat-stories.dto';
import {
  RecordFindingAssessmentResponseDto,
  RecordFindingLinkResponseDto,
  SecurityFindingAssessmentsResponseDto,
  SecurityFindingEvidenceResponseDto,
  SecurityFindingLinksResponseDto,
  SecurityFindingResponseDto,
  SecurityFindingsResponseDto,
  SecurityThreatStoriesResponseDto,
  SecurityThreatStoryResponseDto,
} from './dto/responses.dto';
import { SecurityIngestionService } from './security-ingestion.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('security-ingestion')
@Controller('security-ingestion')
export class SecurityIngestionController {
  constructor(private readonly securityIngestionService: SecurityIngestionService) {}

  @Get('findings')
  @ApiQuery({ name: 'sourceKind', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'assessmentVerdict', required: false, type: String })
  @ApiQuery({ name: 'userVisibleOnly', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: String })
  @ApiOkResponse({
    description: 'List durable security findings for the organization.',
    type: SecurityFindingsResponseDto,
  })
  async listFindings(
    @CurrentAuth() auth: AuthContext | null,
    @Query('sourceKind') sourceKind?: string,
    @Query('status') status?: string,
    @Query('assessmentVerdict') assessmentVerdict?: string,
    @Query('userVisibleOnly') userVisibleOnly?: string,
    @Query('limit') limit?: string,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.securityIngestionService.listFindings(auth.organizationId, {
      sourceKind: sourceKind?.trim() || undefined,
      status: status?.trim() || undefined,
      assessmentVerdict: assessmentVerdict?.trim() || undefined,
      userVisibleOnly: userVisibleOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('findings/:id')
  @ApiOkResponse({
    description: 'Get one durable security finding with evidence.',
    type: SecurityFindingResponseDto,
  })
  async getFinding(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const finding = await this.securityIngestionService.getFinding(auth.organizationId, id);
    if (!finding) throw new NotFoundException('Finding not found');
    return { finding };
  }

  @Get('findings/:id/evidence')
  @ApiOkResponse({
    description: 'List evidence attached to one durable security finding.',
    type: SecurityFindingEvidenceResponseDto,
  })
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

  @Get('findings/:id/assessments')
  @ApiOkResponse({
    description: 'List agent assessments for one durable security finding.',
    type: SecurityFindingAssessmentsResponseDto,
  })
  async listFindingAssessments(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.securityIngestionService.listFindingAssessments(
      auth.organizationId,
      id,
    );
    if (!result) throw new NotFoundException('Finding not found');
    return result;
  }

  @Post('findings/:id/assessments')
  @ApiOkResponse({
    description: 'Record an agent assessment for one durable security finding.',
    type: RecordFindingAssessmentResponseDto,
  })
  async recordFindingAssessment(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecordFindingAssessmentRequestSchema))
    body: RecordFindingAssessmentRequestDto,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const assessment = await this.securityIngestionService.recordFindingAssessment(
      auth.organizationId,
      {
        findingId: id,
        verdict: body.verdict,
        importance: body.importance,
        confidence: body.confidence,
        reasoningMarkdown: body.reasoningMarkdown,
        evidenceRefs: body.evidenceRefs,
        wikiRefs: body.wikiRefs,
        toolCallsSummary: body.toolCallsSummary,
        createdByAgentRunId: body.createdByAgentRunId,
        createdBy: auth.userId,
        metadata: body.metadata,
      },
    );
    return { assessment };
  }

  @Get('findings/:id/links')
  @ApiOkResponse({
    description: 'List links connected to one durable security finding.',
    type: SecurityFindingLinksResponseDto,
  })
  async listFindingLinks(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.securityIngestionService.listFindingLinks(auth.organizationId, id);
    if (!result) throw new NotFoundException('Finding not found');
    return result;
  }

  @Post('findings/:id/links')
  @ApiOkResponse({
    description: 'Record a relationship between two durable security findings.',
    type: RecordFindingLinkResponseDto,
  })
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

  @Get('threat-stories')
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: String })
  @ApiOkResponse({
    description: 'List durable agent-written threat stories.',
    type: SecurityThreatStoriesResponseDto,
  })
  async listThreatStories(
    @CurrentAuth() auth: AuthContext | null,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.securityIngestionService.listThreatStories(auth.organizationId, {
      status: status?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('threat-stories/:id')
  @ApiOkResponse({
    description: 'Get one durable threat story.',
    type: SecurityThreatStoryResponseDto,
  })
  async getThreatStory(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const story = await this.securityIngestionService.getThreatStory(auth.organizationId, id);
    if (!story) throw new NotFoundException('Threat story not found');
    return { story };
  }

  @Post('threat-stories')
  @ApiOkResponse({
    description: 'Record an agent-written threat story over durable findings.',
    type: SecurityThreatStoryResponseDto,
  })
  async recordThreatStory(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(RecordThreatStoryRequestSchema))
    body: RecordThreatStoryRequestDto,
  ) {
    if (!auth?.isAuthenticated || !auth.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const story = await this.securityIngestionService.recordThreatStory(auth.organizationId, {
      storyKey: body.storyKey,
      title: body.title,
      status: body.status,
      severity: body.severity,
      confidence: body.confidence,
      summary: body.summary,
      impact: body.impact,
      attackPath: body.attackPath,
      recommendedAction: body.recommendedAction,
      findingIds: body.findingIds,
      findingRoles: body.findingRoles,
      findingRationales: body.findingRationales,
      evidenceRefs: body.evidenceRefs,
      affectedAssetRefs: body.affectedAssetRefs,
      createdByAgentRunId: body.createdByAgentRunId,
      createdBy: auth.userId,
      metadata: body.metadata,
    });
    return { story };
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
