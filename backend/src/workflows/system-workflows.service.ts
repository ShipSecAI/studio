import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { workflowsTable } from '../database/schema/workflows';
import { workflowTemplatesTable } from '../database/schema/workflow-templates';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import type { WorkflowGraph } from '../database/schema';

export interface SystemWorkflowDto {
  id: string;
  name: string;
  slug: string | null;
  templateId: string;
}

@Injectable()
export class SystemWorkflowsService {
  private readonly logger = new Logger(SystemWorkflowsService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase,
    private readonly workflowRepo: WorkflowRepository,
    private readonly versionRepo: WorkflowVersionRepository,
  ) {}

  async ensureSystemWorkflows(organizationId: string): Promise<SystemWorkflowDto[]> {
    // 1. Get existing system workflows for this org
    const existing = await this.findSystemWorkflows(organizationId);

    // 2. Get default templates directly from DB (avoids circular dep)
    const defaultTemplates = await this.db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.isDefault, true));

    // 3. Create missing ones
    const existingTemplateIds = new Set(existing.map((w) => w.templateId));
    for (const template of defaultTemplates) {
      if (existingTemplateIds.has(template.id)) continue;

      const graph = template.graph as WorkflowGraph;
      let record;
      try {
        record = await this.workflowRepo.createSystemWorkflow(graph, {
          organizationId,
          templateId: template.id,
        });
      } catch (err: any) {
        // unique constraint violation = concurrent creation, skip
        if (err.code === '23505') continue;
        throw err;
      }

      // Create version with rollback on failure
      try {
        await this.versionRepo.create({
          workflowId: record.id,
          graph,
          organizationId,
        });
      } catch (err) {
        await this.workflowRepo.delete(record.id, { organizationId });
        throw err;
      }

      this.logger.log(
        `Created system workflow "${template.name}" (${record.id}) for org ${organizationId}`,
      );
    }

    return this.findSystemWorkflows(organizationId);
  }

  async findSystemWorkflows(organizationId: string): Promise<SystemWorkflowDto[]> {
    const rows = await this.db
      .select({
        id: workflowsTable.id,
        name: workflowsTable.name,
        templateId: workflowsTable.templateId,
        slug: workflowTemplatesTable.slug,
      })
      .from(workflowsTable)
      .leftJoin(workflowTemplatesTable, eq(workflowsTable.templateId, workflowTemplatesTable.id))
      .where(
        and(eq(workflowsTable.organizationId, organizationId), eq(workflowsTable.isSystem, true)),
      );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug ?? null,
      templateId: r.templateId!,
    }));
  }
}
