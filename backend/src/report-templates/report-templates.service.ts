import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { reportTemplates, generatedReports } from '../database/schema/report-templates';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { CreateReportTemplateDto, ListTemplatesQueryDto, UpdateReportTemplateDto } from './dto/template.dto';
import type { AuthContext } from '../auth/types';

@Injectable()
export class ReportTemplatesService {
  private readonly logger = new Logger(ReportTemplatesService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(auth: AuthContext, dto: CreateReportTemplateDto) {
    if (!auth.organizationId) {
      throw new InternalServerErrorException('Organization ID missing in context');
    }

    const [template] = await this.db
      .insert(reportTemplates)
      .values({
        name: dto.name,
        description: dto.description,
        content: dto.content,
        inputSchema: dto.inputSchema,
        sampleData: dto.sampleData ?? null,
        isSystem: dto.isSystem ?? false,
        createdBy: auth.userId || null,
        orgId: auth.organizationId,
      })
      .returning();

    return template;
  }

  async list(auth: AuthContext, query: ListTemplatesQueryDto) {
    if (!auth.organizationId) {
      return [];
    }

    const conditions = [eq(reportTemplates.orgId, auth.organizationId)];

    if (query.isSystem !== undefined) {
      conditions.push(eq(reportTemplates.isSystem, query.isSystem));
    }

    return this.db
      .select()
      .from(reportTemplates)
      .where(and(...conditions))
      .orderBy(desc(reportTemplates.createdAt))
      .limit(query.limit)
      .offset(query.offset);
  }

  async listSystemTemplates() {
    return this.db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.isSystem, true))
      .orderBy(desc(reportTemplates.createdAt));
  }

  async get(auth: AuthContext, id: string) {
    const template = await this.db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.id, id))
      .limit(1);

    const [result] = template;

    if (!result) {
      throw new NotFoundException('Template not found');
    }

    if (!result.isSystem && result.orgId !== auth.organizationId) {
      throw new NotFoundException('Template not found');
    }

    return result;
  }

  async update(auth: AuthContext, id: string, dto: UpdateReportTemplateDto) {
    const existing = await this.get(auth, id);

    if (existing.isSystem) {
      throw new InternalServerErrorException('Cannot modify system templates');
    }

    const [template] = await this.db
      .update(reportTemplates)
      .set({
        ...dto,
        updatedAt: new Date(),
        version: sql`${reportTemplates.version} + 1`,
      })
      .where(eq(reportTemplates.id, id))
      .returning();

    return template;
  }

  async delete(auth: AuthContext, id: string) {
    const existing = await this.get(auth, id);

    if (existing.isSystem) {
      throw new InternalServerErrorException('Cannot delete system templates');
    }

    const result = await this.db
      .delete(reportTemplates)
      .where(eq(reportTemplates.id, id));

    if (result.rowCount === 0) {
      throw new NotFoundException('Template not found');
    }
  }

  async getVersions(auth: AuthContext, id: string) {
    await this.get(auth, id);

    return this.db
      .select({
        id: generatedReports.id,
        templateVersion: generatedReports.templateVersion,
        workflowRunId: generatedReports.workflowRunId,
        generatedAt: generatedReports.generatedAt,
      })
      .from(generatedReports)
      .where(eq(generatedReports.templateId, id))
      .orderBy(desc(generatedReports.generatedAt))
      .limit(50);
  }

  async getById(id: string) {
    const [template] = await this.db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.id, id))
      .limit(1);

    return template || null;
  }

  async createGeneratedReport(data: {
    templateId: string;
    templateVersion: number;
    workflowRunId?: string;
    inputData: Record<string, unknown>;
    artifactId: string;
    orgId: string;
  }) {
    const [report] = await this.db
      .insert(generatedReports)
      .values({
        templateId: data.templateId,
        templateVersion: data.templateVersion,
        workflowRunId: data.workflowRunId || null,
        inputData: data.inputData,
        artifactId: data.artifactId,
        orgId: data.orgId,
      })
      .returning();

    return report;
  }
}
