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
import { workflowVersionsTable } from '../database/schema/workflow-versions';
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
    'Container Image Scan': {
      screenshotUrl: '/templates/container-image-scan.png',
      isFeatured: true,
      runCount: 180,
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

        // Sync default template graphs (e.g. fix Entry Point runtimeInputs)
        await this.syncDefaultGraphs(existing);

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
    const toBackfill = existing.filter(
      (t) => slugMap.has(t.name) && t.slug !== slugMap.get(t.name),
    );
    if (toBackfill.length === 0) return;

    this.logger.log(`Syncing slugs for ${toBackfill.length} template(s)...`);
    for (const template of toBackfill) {
      const slug = slugMap.get(template.name);
      if (!slug) continue;
      await this.db
        .update(workflowTemplatesTable)
        .set({ slug, updatedAt: new Date() })
        .where(eq(workflowTemplatesTable.id, template.id));
    }
    this.logger.log('Slug sync complete');
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

  /**
   * Sync default template graphs with seed data and propagate to system workflows.
   * This ensures Entry Point nodes have correct runtimeInputs and edges are valid.
   */
  private async syncDefaultGraphs(existing: WorkflowTemplate[]) {
    const seedByName = new Map(SEED_TEMPLATES.map((t) => [t.name, t]));
    let updated = 0;

    for (const template of existing) {
      if (!template.isDefault) continue;
      const seed = seedByName.get(template.name);
      if (!seed) continue;

      // Compare graphs by serialization
      const currentGraph = JSON.stringify(template.graph);
      const seedGraph = JSON.stringify(seed.graph);
      if (currentGraph === seedGraph) continue;

      // Update template graph
      await this.db
        .update(workflowTemplatesTable)
        .set({ graph: seed.graph as any, updatedAt: new Date() })
        .where(eq(workflowTemplatesTable.id, template.id));

      // Update all system workflow versions that reference this template.
      // Find system workflows for this template, then update their latest version's
      // graph and clear the compiled definition so it gets re-compiled on next run.
      const systemWorkflows = await this.db
        .select({ id: workflowsTable.id })
        .from(workflowsTable)
        .where(and(eq(workflowsTable.templateId, template.id), eq(workflowsTable.isSystem, true)));

      for (const sw of systemWorkflows) {
        await this.db
          .update(workflowVersionsTable)
          .set({ graph: seed.graph as any, compiledDefinition: null })
          .where(eq(workflowVersionsTable.workflowId, sw.id));
      }

      updated++;
      this.logger.log(
        `Synced graph for template "${template.name}" and ${systemWorkflows.length} system workflow(s)`,
      );
    }

    if (updated > 0) {
      this.logger.log(`Synced ${updated} default template graph(s)`);
    }
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
