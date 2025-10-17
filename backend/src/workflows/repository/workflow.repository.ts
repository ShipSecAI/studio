import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { workflowsTable } from '../../database/schema/workflows';
import { DRIZZLE_TOKEN } from '../../database/database.module';

export type WorkflowRecord = typeof workflowsTable.$inferSelect;

type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

@Injectable()
export class WorkflowRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(input: WorkflowGraph): Promise<WorkflowRecord> {
    const [record] = await this.db
      .insert(workflowsTable)
      .values({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
      })
      .returning();

    return record;
  }

  async update(id: string, input: WorkflowGraph): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(),
      })
      .where(eq(workflowsTable.id, id))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async saveCompiledDefinition(
    id: string,
    definition: WorkflowDefinition,
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        compiledDefinition: definition,
        updatedAt: new Date(),
      })
      .where(eq(workflowsTable.id, id))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async findById(id: string): Promise<WorkflowRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, id))
      .limit(1);
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workflowsTable).where(eq(workflowsTable.id, id));
  }

  async list(): Promise<WorkflowRecord[]> {
    return this.db.select().from(workflowsTable);
  }

  async incrementRunCount(id: string): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        lastRun: new Date(),
        runCount: sql`${workflowsTable.runCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workflowsTable.id, id))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }
}
