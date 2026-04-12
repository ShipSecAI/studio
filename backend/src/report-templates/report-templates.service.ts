import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';
import type { AuthContext } from '../auth/types';
import {
  reportTemplatesTable,
  reportTemplateVersionsTable,
  type NewReportTemplate,
  type NewReportTemplateVersion,
  type ReportTemplate,
  type ReportTemplateStatus,
  type ReportTemplateVersion,
} from '../database/schema/report-templates';
import {
  renderReportTemplateDocument,
  type RenderedReportTemplate,
} from './report-template-renderer';
import { SEED_REPORT_TEMPLATES } from './seed-report-templates';

type JsonRecord = Record<string, unknown>;

interface HydratedTemplate {
  template: ReportTemplate;
  publishedVersion: ReportTemplateVersion | null;
  draftVersion: ReportTemplateVersion | null;
}

@Injectable()
export class ReportTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(ReportTemplatesService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async onModuleInit() {
    try {
      const existingBuiltins = await this.db
        .select()
        .from(reportTemplatesTable)
        .where(eq(reportTemplatesTable.scope, 'builtin'));

      const existingBySlug = new Set(existingBuiltins.map((template) => template.slug));
      for (const seed of SEED_REPORT_TEMPLATES) {
        if (existingBySlug.has(seed.template.slug)) {
          continue;
        }

        const [template] = await this.db
          .insert(reportTemplatesTable)
          .values(seed.template as NewReportTemplate)
          .returning();

        const [publishedVersion] = await this.db
          .insert(reportTemplateVersionsTable)
          .values({
            ...seed.publishedVersion,
            templateId: template.id,
          } as NewReportTemplateVersion)
          .returning();

        await this.db
          .update(reportTemplatesTable)
          .set({
            publishedVersionId: publishedVersion.id,
            status: 'published',
            visibility: 'library',
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reportTemplatesTable.id, template.id));
      }
    } catch (error) {
      this.logger.warn('Could not seed report templates (table may not exist yet)', error);
    }
  }

  async listPublished(auth: AuthContext): Promise<ReturnType<typeof this.toResponse>[]> {
    const organizationId = this.requireOrganizationId(auth);
    const templates = await this.db
      .select()
      .from(reportTemplatesTable)
      .where(
        and(
          eq(reportTemplatesTable.visibility, 'library'),
          or(
            eq(reportTemplatesTable.scope, 'builtin'),
            and(
              eq(reportTemplatesTable.scope, 'organization'),
              eq(reportTemplatesTable.organizationId, organizationId),
            ),
          ),
        ),
      )
      .orderBy(desc(reportTemplatesTable.updatedAt));

    return this.hydrateTemplates(templates).then((items) =>
      items.map((item) => this.toResponse(item)),
    );
  }

  async getPublishedTemplate(id: string, auth: AuthContext) {
    const template = await this.findAccessibleTemplate(id, auth);
    if (!template.template.publishedVersionId || !template.publishedVersion) {
      throw new NotFoundException(`Published report template ${id} not found`);
    }
    return this.toResponse(template);
  }

  async getDraftTemplate(id: string, auth: AuthContext) {
    const template = await this.findAccessibleTemplate(id, auth);
    if (!template.draftVersion) {
      throw new NotFoundException(`Draft for report template ${id} not found`);
    }
    return this.toResponse(template);
  }

  async createDraft(
    auth: AuthContext,
    input: {
      name: string;
      description?: string;
      category: string;
      htmlTemplate: string;
      css: string;
      inputSchema: JsonRecord;
      sampleData: JsonRecord;
      chatSessionId?: string;
    },
  ) {
    const organizationId = this.requireOrganizationId(auth);
    const slug = this.slugify(input.name);

    const [template] = await this.db
      .insert(reportTemplatesTable)
      .values({
        organizationId,
        name: input.name,
        slug: `${slug}-${Date.now().toString(36)}`,
        description: input.description ?? null,
        category: input.category,
        status: 'draft',
        scope: 'organization',
        visibility: 'chat_only',
        createdBy: auth.userId,
        draftSessionId: input.chatSessionId ?? null,
      })
      .returning();

    const [draftVersion] = await this.db
      .insert(reportTemplateVersionsTable)
      .values({
        templateId: template.id,
        versionNumber: 1,
        kind: 'draft',
        name: input.name,
        description: input.description ?? null,
        htmlTemplate: input.htmlTemplate,
        css: input.css,
        inputSchema: input.inputSchema,
        sampleData: input.sampleData,
        createdBy: auth.userId,
      })
      .returning();

    await this.db
      .update(reportTemplatesTable)
      .set({
        draftVersionId: draftVersion.id,
        updatedAt: new Date(),
      })
      .where(eq(reportTemplatesTable.id, template.id));

    return this.toResponse({
      template: { ...template, draftVersionId: draftVersion.id },
      draftVersion,
      publishedVersion: null,
    });
  }

  async updateDraft(
    id: string,
    auth: AuthContext,
    input: {
      name?: string;
      description?: string | null;
      category?: string;
      htmlTemplate?: string;
      css?: string;
      inputSchema?: JsonRecord;
      sampleData?: JsonRecord;
      chatSessionId?: string | null;
    },
  ) {
    const hydrated = await this.findAccessibleTemplate(id, auth);
    if (hydrated.template.scope === 'builtin') {
      throw new ForbiddenException('Built-in report templates cannot be edited');
    }

    const draftVersion =
      hydrated.draftVersion ??
      (await this.createDraftFromPublishedVersion(
        hydrated.template,
        hydrated.publishedVersion,
        auth,
      ));

    const nextName = input.name ?? draftVersion.name;
    const nextDescription =
      input.description === undefined ? draftVersion.description : input.description;
    const nextCategory = input.category ?? hydrated.template.category;

    const [updatedDraft] = await this.db
      .update(reportTemplateVersionsTable)
      .set({
        name: nextName,
        description: nextDescription,
        htmlTemplate: input.htmlTemplate ?? draftVersion.htmlTemplate,
        css: input.css ?? draftVersion.css,
        inputSchema: input.inputSchema ?? (draftVersion.inputSchema as JsonRecord),
        sampleData: input.sampleData ?? (draftVersion.sampleData as JsonRecord),
      })
      .where(eq(reportTemplateVersionsTable.id, draftVersion.id))
      .returning();

    const [updatedTemplate] = await this.db
      .update(reportTemplatesTable)
      .set({
        name: hydrated.template.publishedVersionId ? hydrated.template.name : nextName,
        slug: hydrated.template.slug,
        description:
          hydrated.template.publishedVersionId && hydrated.template.status === 'published'
            ? hydrated.template.description
            : nextDescription,
        category: hydrated.template.publishedVersionId ? hydrated.template.category : nextCategory,
        status: hydrated.template.publishedVersionId
          ? hydrated.template.status
          : ('draft' as ReportTemplateStatus),
        visibility: hydrated.template.publishedVersionId
          ? hydrated.template.visibility
          : 'chat_only',
        draftVersionId: updatedDraft.id,
        draftSessionId:
          input.chatSessionId === undefined
            ? hydrated.template.draftSessionId
            : input.chatSessionId,
        updatedAt: new Date(),
      })
      .where(eq(reportTemplatesTable.id, hydrated.template.id))
      .returning();

    return this.toResponse({
      template: updatedTemplate,
      draftVersion: updatedDraft,
      publishedVersion: hydrated.publishedVersion,
    });
  }

  async publish(id: string, auth: AuthContext) {
    const hydrated = await this.findAccessibleTemplate(id, auth);
    if (hydrated.template.scope === 'builtin') {
      throw new ForbiddenException('Built-in report templates cannot be published');
    }
    if (!hydrated.draftVersion) {
      throw new BadRequestException('Report template has no active draft to publish');
    }

    const nextVersionNumber = await this.getNextPublishedVersionNumber(hydrated.template.id);
    const [publishedVersion] = await this.db
      .insert(reportTemplateVersionsTable)
      .values({
        templateId: hydrated.template.id,
        versionNumber: nextVersionNumber,
        kind: 'published',
        name: hydrated.draftVersion.name,
        description: hydrated.draftVersion.description,
        htmlTemplate: hydrated.draftVersion.htmlTemplate,
        css: hydrated.draftVersion.css,
        inputSchema: hydrated.draftVersion.inputSchema,
        sampleData: hydrated.draftVersion.sampleData,
        createdBy: auth.userId,
      })
      .returning();

    const [updatedTemplate] = await this.db
      .update(reportTemplatesTable)
      .set({
        name: hydrated.draftVersion.name,
        slug: this.ensureUniquePublishedSlug(
          this.slugify(hydrated.draftVersion.name),
          hydrated.template.id,
        ),
        description: hydrated.draftVersion.description,
        category: hydrated.template.category,
        status: 'published',
        visibility: 'library',
        publishedVersionId: publishedVersion.id,
        draftVersionId: null,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reportTemplatesTable.id, hydrated.template.id))
      .returning();

    return this.toResponse({
      template: updatedTemplate,
      publishedVersion,
      draftVersion: null,
    });
  }

  async renderDraftPreview(
    id: string,
    auth: AuthContext,
    data: JsonRecord,
  ): Promise<{
    templateId: string;
    versionId: string;
    versionNumber: number;
    kind: 'draft' | 'published';
    html: string;
    css: string;
    data: JsonRecord;
  }> {
    const hydrated = await this.findAccessibleTemplate(id, auth);
    const version = hydrated.draftVersion ?? hydrated.publishedVersion;
    if (!version) {
      throw new NotFoundException(`Report template ${id} has no renderable version`);
    }

    const payload = {
      ...(version.sampleData as JsonRecord),
      ...data,
    };
    const rendered = await this.renderVersion(version, payload);

    return {
      templateId: hydrated.template.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      kind: version.kind,
      html: rendered.html,
      css: rendered.css,
      data: payload,
    };
  }

  async renderPublishedVersion(
    id: string,
    versionId: string | null | undefined,
    auth: AuthContext,
    data: JsonRecord,
  ) {
    const hydrated = await this.findAccessibleTemplate(id, auth);
    const version =
      versionId != null
        ? await this.getSpecificPublishedVersion(hydrated.template, versionId)
        : hydrated.publishedVersion;

    if (!version || version.kind !== 'published') {
      throw new NotFoundException(`Published report template version not found for ${id}`);
    }

    const payload = {
      ...(version.sampleData as JsonRecord),
      ...data,
    };
    const rendered = await this.renderVersion(version, payload);

    return {
      templateId: hydrated.template.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      kind: version.kind,
      html: rendered.html,
      css: rendered.css,
      data: payload,
    };
  }

  async getPublishedVersion(id: string, versionId: string, auth: AuthContext) {
    const hydrated = await this.findAccessibleTemplate(id, auth);
    const version = await this.getSpecificPublishedVersion(hydrated.template, versionId);
    return {
      ...version,
      inputSchema: (version.inputSchema ?? {}) as JsonRecord,
      sampleData: (version.sampleData ?? {}) as JsonRecord,
    };
  }

  private async createDraftFromPublishedVersion(
    template: ReportTemplate,
    publishedVersion: ReportTemplateVersion | null,
    auth: AuthContext,
  ) {
    if (!publishedVersion) {
      throw new BadRequestException('No published version exists to create a draft from');
    }

    const [draftVersion] = await this.db
      .insert(reportTemplateVersionsTable)
      .values({
        templateId: template.id,
        versionNumber: publishedVersion.versionNumber,
        kind: 'draft',
        name: publishedVersion.name,
        description: publishedVersion.description,
        htmlTemplate: publishedVersion.htmlTemplate,
        css: publishedVersion.css,
        inputSchema: publishedVersion.inputSchema,
        sampleData: publishedVersion.sampleData,
        createdBy: auth.userId,
      })
      .returning();

    await this.db
      .update(reportTemplatesTable)
      .set({
        draftVersionId: draftVersion.id,
        updatedAt: new Date(),
      })
      .where(eq(reportTemplatesTable.id, template.id));

    return draftVersion;
  }

  private async hydrateTemplates(templates: ReportTemplate[]): Promise<HydratedTemplate[]> {
    const publishedIds = templates
      .map((template) => template.publishedVersionId)
      .filter((value): value is string => Boolean(value));
    const draftIds = templates
      .map((template) => template.draftVersionId)
      .filter((value): value is string => Boolean(value));

    const versionIds = [...new Set([...publishedIds, ...draftIds])];
    const versions =
      versionIds.length > 0
        ? await this.db
            .select()
            .from(reportTemplateVersionsTable)
            .where(inArray(reportTemplateVersionsTable.id, versionIds))
        : [];

    const versionsById = new Map(versions.map((version) => [version.id, version]));

    return templates.map((template) => ({
      template,
      publishedVersion: template.publishedVersionId
        ? (versionsById.get(template.publishedVersionId) ?? null)
        : null,
      draftVersion: template.draftVersionId
        ? (versionsById.get(template.draftVersionId) ?? null)
        : null,
    }));
  }

  private async findAccessibleTemplate(id: string, auth: AuthContext): Promise<HydratedTemplate> {
    const organizationId = this.requireOrganizationId(auth);
    const [template] = await this.db
      .select()
      .from(reportTemplatesTable)
      .where(
        and(
          eq(reportTemplatesTable.id, id),
          or(
            eq(reportTemplatesTable.scope, 'builtin'),
            and(
              eq(reportTemplatesTable.scope, 'organization'),
              eq(reportTemplatesTable.organizationId, organizationId),
            ),
          ),
        ),
      )
      .limit(1);

    if (!template) {
      throw new NotFoundException(`Report template ${id} not found`);
    }

    const [hydrated] = await this.hydrateTemplates([template]);
    return hydrated;
  }

  private async getSpecificPublishedVersion(template: ReportTemplate, versionId: string) {
    const [version] = await this.db
      .select()
      .from(reportTemplateVersionsTable)
      .where(
        and(
          eq(reportTemplateVersionsTable.id, versionId),
          eq(reportTemplateVersionsTable.templateId, template.id),
          eq(reportTemplateVersionsTable.kind, 'published'),
        ),
      )
      .limit(1);

    if (!version) {
      throw new NotFoundException(`Published report template version ${versionId} not found`);
    }

    return version;
  }

  private async renderVersion(
    version: ReportTemplateVersion,
    data: JsonRecord,
  ): Promise<RenderedReportTemplate> {
    return renderReportTemplateDocument({
      htmlTemplate: version.htmlTemplate,
      css: version.css,
      data,
    });
  }

  private async getNextPublishedVersionNumber(templateId: string): Promise<number> {
    const publishedVersions = await this.db
      .select()
      .from(reportTemplateVersionsTable)
      .where(
        and(
          eq(reportTemplateVersionsTable.templateId, templateId),
          eq(reportTemplateVersionsTable.kind, 'published'),
        ),
      )
      .orderBy(desc(reportTemplateVersionsTable.versionNumber))
      .limit(1);

    return (publishedVersions[0]?.versionNumber ?? 0) + 1;
  }

  private requireOrganizationId(auth: AuthContext): string {
    if (!auth.organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return auth.organizationId;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  }

  private ensureUniquePublishedSlug(slug: string, templateId: string): string {
    return `${slug}-${templateId.slice(0, 8)}`;
  }

  private toResponse(item: HydratedTemplate) {
    const { template, publishedVersion, draftVersion } = item;
    return {
      ...template,
      organizationId: template.organizationId ?? null,
      description: template.description ?? null,
      createdBy: template.createdBy ?? null,
      publishedAt: template.publishedAt?.toISOString() ?? null,
      publishedVersionId: template.publishedVersionId ?? null,
      draftVersionId: template.draftVersionId ?? null,
      draftSessionId: template.draftSessionId ?? null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      publishedVersion: publishedVersion
        ? {
            ...publishedVersion,
            description: publishedVersion.description ?? null,
            createdBy: publishedVersion.createdBy ?? null,
            inputSchema: (publishedVersion.inputSchema ?? {}) as JsonRecord,
            sampleData: (publishedVersion.sampleData ?? {}) as JsonRecord,
            createdAt: publishedVersion.createdAt.toISOString(),
          }
        : null,
      draftVersion: draftVersion
        ? {
            ...draftVersion,
            description: draftVersion.description ?? null,
            createdBy: draftVersion.createdBy ?? null,
            inputSchema: (draftVersion.inputSchema ?? {}) as JsonRecord,
            sampleData: (draftVersion.sampleData ?? {}) as JsonRecord,
            createdAt: draftVersion.createdAt.toISOString(),
          }
        : null,
    };
  }
}
