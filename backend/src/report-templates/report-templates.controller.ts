import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ReportTemplatesService } from './report-templates.service';
import {
  CreateReportTemplateDto,
  ListTemplatesQueryDto,
  PreviewTemplateDto,
  PreviewTemplateResponseDto,
  TemplateResponseDto,
  UpdateReportTemplateDto,
  GenerateReportDto,
  GenerateReportResponseDto,
} from './dto/template.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ZodValidationPipe } from 'nestjs-zod';
import { ZodSchema } from 'zod';

const CreateReportTemplateSchema: ZodSchema = CreateReportTemplateDto.schema;
const UpdateReportTemplateSchema: ZodSchema = UpdateReportTemplateDto.schema;
const ListTemplatesQuerySchema: ZodSchema = ListTemplatesQueryDto.schema;
const GenerateReportSchema: ZodSchema = GenerateReportDto.schema;
const PreviewTemplateSchema: ZodSchema = PreviewTemplateDto.schema;

@Controller('templates')
@UseGuards(AuthGuard)
export class ReportTemplatesController {
  constructor(
    private readonly templatesService: ReportTemplatesService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [TemplateResponseDto] })
  async list(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListTemplatesQuerySchema)) query: ListTemplatesQueryDto,
  ) {
    const context = this.requireAuth(auth);
    const templates = await this.templatesService.list(context, query);
    return templates.map((template) => this.toTemplateResponse(template));
  }

  @Get('system')
  @ApiOkResponse({ type: [TemplateResponseDto] })
  async listSystem(@CurrentAuth() _auth: AuthContext | null) {
    this.requireAuth(_auth);
    const templates = await this.templatesService.listSystemTemplates();
    return templates.map((template) => this.toTemplateResponse(template));
  }

  @Post()
  @ApiCreatedResponse({ type: TemplateResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(CreateReportTemplateSchema)) dto: CreateReportTemplateDto,
  ) {
    const context = this.requireAuth(auth);
    const template = await this.templatesService.create(context, dto);
    return this.toTemplateResponse(template);
  }

  @Get(':id')
  @ApiOkResponse({ type: TemplateResponseDto })
  async get(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ) {
    const context = this.requireAuth(auth);
    const template = await this.templatesService.get(context, id);
    return this.toTemplateResponse(template);
  }

  @Put(':id')
  @ApiOkResponse({ type: TemplateResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReportTemplateSchema)) dto: UpdateReportTemplateDto,
  ) {
    const context = this.requireAuth(auth);
    const template = await this.templatesService.update(context, id, dto);
    return this.toTemplateResponse(template);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async delete(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ) {
    const context = this.requireAuth(auth);
    await this.templatesService.delete(context, id);
  }

  @Get(':id/versions')
  async getVersions(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ) {
    const context = this.requireAuth(auth);
    return this.templatesService.getVersions(context, id);
  }

  @Post(':id/preview')
  @ApiResponse({ status: 201, type: PreviewTemplateResponseDto })
  async preview(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PreviewTemplateSchema)) body: PreviewTemplateDto,
  ): Promise<PreviewTemplateResponseDto> {
    const context = this.requireAuth(auth);
    const template = await this.templatesService.get(context, id);
    return PreviewTemplateResponseDto.create({
      templateId: template.id,
      templateVersion: template.version,
      sampleData: body.data || {},
      renderedHtml: '', // Frontend handles local rendering now
    });
  }

  @Post('generate')
  @ApiCreatedResponse({ type: GenerateReportResponseDto })
  async generate(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(GenerateReportSchema)) dto: GenerateReportDto,
  ): Promise<GenerateReportResponseDto> {
    const context = this.requireAuth(auth);
    const template = await this.templatesService.get(context, dto.templateId);
    return {
      artifactId: '',
      fileName: dto.fileName ?? `report-${Date.now()}.${dto.format}`,
      format: dto.format,
      size: 0,
      templateId: template.id,
      templateVersion: template.version.toString(),
      generatedAt: new Date().toISOString(),
    };
  }

  private requireAuth(auth: AuthContext | null): AuthContext {
    if (!auth?.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return auth;
  }

  private toTemplateResponse(template: {
    id: string;
    name: string;
    description: string | null;
    content: unknown;
    inputSchema: unknown;
    sampleData: unknown;
    version: number;
    isSystem: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
  }) {
    const createdAt = template.createdAt instanceof Date
      ? template.createdAt.toISOString()
      : template.createdAt;
    const updatedAt = template.updatedAt instanceof Date
      ? template.updatedAt.toISOString()
      : template.updatedAt;

    return TemplateResponseDto.create({
      ...template,
      content: template.content as Record<string, unknown>,
      inputSchema: template.inputSchema as Record<string, unknown>,
      sampleData: template.sampleData as Record<string, unknown> | null,
      createdAt,
      updatedAt,
    });
  }
}
