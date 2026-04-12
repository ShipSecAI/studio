import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  CreateReportTemplateDraftRequestDto,
  PublishReportTemplateRequestDto,
  RenderPublishedReportTemplateRequestDto,
  RenderReportTemplatePreviewRequestDto,
  RenderReportTemplateResponseDto,
  ReportTemplateResponseDto,
  ReportTemplateVersionResponseDto,
  UpdateReportTemplateDraftRequestDto,
} from './dto/report-template.dto';
import { ReportTemplatesService } from './report-templates.service';

@ApiTags('report-templates')
@Controller('report-templates')
export class ReportTemplatesController {
  constructor(private readonly service: ReportTemplatesService) {}

  @Get()
  @ApiOkResponse({ type: [ReportTemplateResponseDto] })
  async listPublished(@CurrentAuth() auth: AuthContext) {
    return this.service.listPublished(auth);
  }

  @Get(':id')
  @ApiOkResponse({ type: ReportTemplateResponseDto })
  async getPublished(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.service.getPublishedTemplate(id, auth);
  }

  @Get(':id/draft')
  @ApiOkResponse({ type: ReportTemplateResponseDto })
  async getDraft(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.service.getDraftTemplate(id, auth);
  }

  @Get(':id/versions/:versionId')
  @ApiOkResponse({ type: ReportTemplateVersionResponseDto })
  async getPublishedVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.service.getPublishedVersion(id, versionId, auth);
  }

  @Post('drafts')
  @ApiOkResponse({ type: ReportTemplateResponseDto })
  async createDraft(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateReportTemplateDraftRequestDto,
  ) {
    return this.service.createDraft(auth, body);
  }

  @Patch(':id/draft')
  @ApiOkResponse({ type: ReportTemplateResponseDto })
  async updateDraft(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: UpdateReportTemplateDraftRequestDto,
  ) {
    return this.service.updateDraft(id, auth, body);
  }

  @Post(':id/preview')
  @ApiOkResponse({ type: RenderReportTemplateResponseDto })
  async renderPreview(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: RenderReportTemplatePreviewRequestDto,
  ) {
    return this.service.renderDraftPreview(id, auth, body.data);
  }

  @Post(':id/publish')
  @ApiOkResponse({ type: ReportTemplateResponseDto })
  async publish(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() _body: PublishReportTemplateRequestDto,
  ) {
    return this.service.publish(id, auth);
  }

  @Post(':id/render')
  @ApiOkResponse({ type: RenderReportTemplateResponseDto })
  async renderPublished(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() body: RenderPublishedReportTemplateRequestDto,
  ) {
    return this.service.renderPublishedVersion(id, body.versionId ?? null, auth, body.data ?? {});
  }
}
