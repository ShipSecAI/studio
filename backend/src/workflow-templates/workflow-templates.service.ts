import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  type OnModuleInit,
} from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import {
  workflowTemplatesTable,
  type WorkflowTemplate,
  type NewWorkflowTemplate,
} from '../database/schema/workflow-templates';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { workflowsTable } from '../database/schema/workflows';
import { SEED_TEMPLATES } from './seed-templates';

@Injectable()
export class WorkflowTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowTemplatesService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Metadata to backfill on existing templates that lack screenshotUrl. */
  private static readonly TEMPLATE_METADATA: Record<
    string,
    { screenshotUrl: string; isFeatured: boolean; runCount: number }
  > = {
    'Secret Scan': { screenshotUrl: '/templates/secret-scan.png', isFeatured: true, runCount: 760 },
    'Full Code Security': {
      screenshotUrl: '/templates/full-code-security.png',
      isFeatured: true,
      runCount: 890,
    },
    'PR Security Gate': {
      screenshotUrl: '/templates/pr-security-gate.png',
      isFeatured: false,
      runCount: 620,
    },
    'AI Code Review': {
      screenshotUrl: '/templates/ai-code-review.png',
      isFeatured: true,
      runCount: 1240,
    },
    'Cloud Security Scan': {
      screenshotUrl: '/templates/cloud-security-scan.png',
      isFeatured: true,
      runCount: 310,
    },
    'Attack Surface Recon': {
      screenshotUrl: '/templates/attack-surface-recon.png',
      isFeatured: true,
      runCount: 430,
    },
  };

  async onModuleInit() {
    try {
      const existing = await this.list();
      if (existing.length === 0) {
        this.logger.log('No templates found — seeding default templates...');
        for (const template of SEED_TEMPLATES) {
          await this.create(template);
        }
        this.logger.log(`Seeded ${SEED_TEMPLATES.length} default templates`);
      } else {
        // Seed any missing default templates (e.g. new ones added after initial seed)
        const existingNames = new Set(existing.map((t) => t.name));
        const missing = SEED_TEMPLATES.filter((t) => !existingNames.has(t.name));
        if (missing.length > 0) {
          this.logger.log(`Seeding ${missing.length} missing default template(s)...`);
          for (const t of missing) {
            await this.create(t);
          }
        }

        // Backfill slug for existing templates that lack it
        await this.backfillSlugs(existing);

        // Backfill metadata for existing templates that lack screenshotUrl
        await this.backfillMetadata(existing);

        // Remove stale default templates no longer in SEED_TEMPLATES
        await this.removeStaleDefaults(existing);
      }
    } catch (error) {
      // Table may not exist yet if migration hasn't run — that's OK
      this.logger.warn('Could not seed templates (table may not exist yet)', error);
    }
  }

  private async backfillSlugs(existing: WorkflowTemplate[]) {
    const slugMap = new Map(SEED_TEMPLATES.map((t) => [t.name, t.slug]));
    const toBackfill = existing.filter((t) => !t.slug && slugMap.has(t.name));
    if (toBackfill.length === 0) return;

    this.logger.log(`Backfilling slugs for ${toBackfill.length} template(s)...`);
    for (const template of toBackfill) {
      const slug = slugMap.get(template.name);
      if (!slug) continue;
      await this.db
        .update(workflowTemplatesTable)
        .set({ slug, updatedAt: new Date() })
        .where(eq(workflowTemplatesTable.id, template.id));
    }
    this.logger.log('Slug backfill complete');
  }

  private async backfillMetadata(existing: WorkflowTemplate[]) {
    const toBackfill = existing.filter((t) => !t.screenshotUrl && t.isDefault);
    if (toBackfill.length === 0) return;

    this.logger.log(`Backfilling metadata for ${toBackfill.length} templates...`);
    for (const template of toBackfill) {
      const meta = WorkflowTemplatesService.TEMPLATE_METADATA[template.name];
      if (!meta) continue;

      await this.db
        .update(workflowTemplatesTable)
        .set({
          screenshotUrl: meta.screenshotUrl,
          isFeatured: meta.isFeatured,
          runCount: meta.runCount,
          updatedAt: new Date(),
        })
        .where(eq(workflowTemplatesTable.id, template.id));
    }
    this.logger.log('Backfill complete');
  }

  private async removeStaleDefaults(existing: WorkflowTemplate[]) {
    const seedNames = new Set(SEED_TEMPLATES.map((t) => t.name));
    const stale = existing.filter((t) => t.isDefault && !seedNames.has(t.name));
    if (stale.length === 0) return;

    const staleIds = stale.map((t) => t.id);
    this.logger.log(
      `Removing ${stale.length} stale default template(s): ${stale.map((t) => t.name).join(', ')}`,
    );

    // Delete system workflows referencing these templates first
    await this.db
      .delete(workflowsTable)
      .where(and(eq(workflowsTable.isSystem, true), inArray(workflowsTable.templateId, staleIds)));

    // Delete the stale templates
    for (const id of staleIds) {
      await this.db.delete(workflowTemplatesTable).where(eq(workflowTemplatesTable.id, id));
    }

    this.logger.log('Stale default templates removed');
  }

  async list(): Promise<WorkflowTemplate[]> {
    return this.db
      .select()
      .from(workflowTemplatesTable)
      .orderBy(desc(workflowTemplatesTable.createdAt));
  }

  async getById(id: string): Promise<WorkflowTemplate> {
    const [template] = await this.db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.id, id))
      .limit(1);

    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    return template;
  }

  async create(input: NewWorkflowTemplate): Promise<WorkflowTemplate> {
    const [template] = await this.db.insert(workflowTemplatesTable).values(input).returning();

    this.logger.log(`Created template "${template.name}" (${template.id})`);
    return template;
  }

  async update(
    id: string,
    input: Partial<Omit<NewWorkflowTemplate, 'id'>>,
  ): Promise<WorkflowTemplate> {
    const [template] = await this.db
      .update(workflowTemplatesTable)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(workflowTemplatesTable.id, id))
      .returning();

    if (!template) {
      throw new NotFoundException(`Template ${id} not found`);
    }

    return template;
  }

  async delete(id: string): Promise<void> {
    const template = await this.getById(id);
    if (template.isDefault) {
      throw new ForbiddenException('Default templates cannot be deleted');
    }

    await this.db.delete(workflowTemplatesTable).where(eq(workflowTemplatesTable.id, id));
  }
}
