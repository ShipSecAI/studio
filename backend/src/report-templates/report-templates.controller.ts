import {
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
  UseGuards,
  StreamablePipe,
  Res,
} from '@nestjs/common';
import { ReportTemplatesService } from './report-templates.service';
import {
  CreateReportTemplateDto,
  ListTemplatesQueryDto,
  TemplateResponseDto,
  UpdateReportTemplateDto,
  GenerateReportDto,
  GenerateReportResponseDto,
  GenerateTemplateDto,
} from './dto/template.dto';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ZodSchema } from 'nestjs-zod';
import { streamText, generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const CreateReportTemplateSchema: ZodSchema = CreateReportTemplateDto.schema;
const UpdateReportTemplateSchema: ZodSchema = UpdateReportTemplateDto.schema;
const ListTemplatesQuerySchema: ZodSchema = ListTemplatesQueryDto.schema;
const GenerateReportSchema: ZodSchema = GenerateReportDto.schema;
const GenerateTemplateSchema: ZodSchema = GenerateTemplateDto.schema;

const openai = createOpenAI({
  baseUrl: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

@Controller('templates')
@UseGuards(AuthGuard)
export class ReportTemplatesController {
  constructor(
    private readonly templatesService: ReportTemplatesService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListTemplatesQuerySchema)) query: ListTemplatesQueryDto,
  ) {
    const templates = await this.templatesService.list({} as any, query);
    return templates.map((t) => TemplateResponseDto.create(t));
  }

  @Get('system')
  async listSystem() {
    const templates = await this.templatesService.listSystemTemplates();
    return templates.map((t) => TemplateResponseDto.create(t));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateReportTemplateSchema)) dto: CreateReportTemplateDto,
  ) {
    const template = await this.templatesService.create({} as any, dto);
    return TemplateResponseDto.create(template);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const template = await this.templatesService.get({} as any, id);
    return TemplateResponseDto.create(template);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReportTemplateSchema)) dto: UpdateReportTemplateDto,
  ) {
    const template = await this.templatesService.update({} as any, id, dto);
    return TemplateResponseDto.create(template);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.templatesService.delete({} as any, id);
  }

  @Get(':id/versions')
  async getVersions(@Param('id') id: string) {
    return this.templatesService.getVersions({} as any, id);
  }

  @Post(':id/preview')
  async preview(
    @Param('id') id: string,
    @Body() body: { data: Record<string, unknown> },
  ) {
    const template = await this.templatesService.get({} as any, id);
    return {
      templateId: template.id,
      templateVersion: template.version,
      sampleData: body.data,
      renderedHtml: '',
    };
  }

  @Post('generate')
  async generate(
    @Body(new ZodValidationPipe(GenerateReportSchema)) dto: GenerateReportDto,
  ): Promise<GenerateReportResponseDto> {
    const template = await this.templatesService.get({} as any, dto.templateId);
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

  @Post('ai-generate')
  async aiGenerate(
    @Body(new ZodValidationPipe(GenerateTemplateSchema)) dto: GenerateTemplateDto,
    @Res() res: Res,
  ) {
    const systemPrompt = dto.systemPrompt || `You are a report template generation expert. 
Generate a custom HTML template for security reports using our template syntax.

Template Syntax:
- \`{{variable}}\` - Interpolate variables
- \`{{#each items as item}}\` ... \`{{/each}}\` - Loop through arrays
- \`{{#if condition}}\` ... \`{{/if}}\` - Conditional rendering

Available data fields:
- findings: Array of security findings with severity, title, description, cve, cvss, proof, remediation
- metadata: Object with clientName, date, reportTitle, preparedBy
- scope: Array of targets tested

The template should include:
1. Executive summary with severity counts
2. Detailed findings section
3. Scope section
4. Professional styling with ShipSec branding

Return ONLY the template HTML, no explanations.`;

    const result = streamText({
      model: openai(dto.model || 'gpt-4o-mini'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dto.prompt },
      ],
      temperature: 0.7,
    });

    result.pipeToResponse(res);
  }

  @Post('ai-generate-structured')
  async aiGenerateStructured(
    @Body(new ZodValidationPipe(GenerateTemplateSchema)) dto: GenerateTemplateDto,
  ) {
    const systemPrompt = `You are a report template generation expert.
Generate a custom HTML template for security reports.

Return a JSON object with:
- template: The HTML template string
- description: Brief description of the template
- inputSchema: JSON Schema for the template inputs`;

    const result = await generateObject({
      model: openai(dto.model || 'gpt-4o-mini'),
      schema: z.object({
        template: z.string().describe('The HTML template string'),
        description: z.string().describe('Brief description of the template'),
        inputSchema: z.record(z.unknown()).describe('JSON Schema for template inputs'),
      }),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dto.prompt },
      ],
      temperature: 0.7,
    });

    return result.object;
  }
}
