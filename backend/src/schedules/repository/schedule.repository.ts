import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type WorkflowScheduleRecord,
  type WorkflowScheduleInsert,
  workflowSchedulesTable,
} from '../../database/schema';

export interface ScheduleRepositoryFilters {
  workflowId?: string;
  status?: string;
  organizationId?: string | null;
}

@Injectable()
export class ScheduleRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    values: Omit<WorkflowScheduleInsert, 'id'>,
  ): Promise<WorkflowScheduleRecord> {
    const [record] = await this.db
      .insert(workflowSchedulesTable)
      .values(values)
      .returning();
    return record;
  }

  async update(
    id: string,
    values: Partial<WorkflowScheduleInsert>,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowScheduleRecord | undefined> {
    const [record] = await this.db
      .update(workflowSchedulesTable)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();
    return record;
  }

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowScheduleRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowSchedulesTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);
    return record;
  }

  async delete(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<void> {
    await this.db
      .delete(workflowSchedulesTable)
      .where(this.buildIdFilter(id, options.organizationId));
  }

  async list(filters: ScheduleRepositoryFilters = {}): Promise<WorkflowScheduleRecord[]> {
    const conditions: SQL<unknown>[] = [];

    if (filters.workflowId) {
      conditions.push(eq(workflowSchedulesTable.workflowId, filters.workflowId));
    }

    if (filters.status) {
      conditions.push(eq(workflowSchedulesTable.status, filters.status));
    }

    if (filters.organizationId) {
      conditions.push(eq(workflowSchedulesTable.organizationId, filters.organizationId));
    }

    const baseQuery = this.db.select().from(workflowSchedulesTable);

    if (conditions.length === 0) {
      return baseQuery.orderBy(asc(workflowSchedulesTable.name));
    }

    let combinedCondition: SQL<unknown> = conditions[0]!;
    for (let index = 1; index < conditions.length; index += 1) {
      const nextCondition = and(combinedCondition, conditions[index]!);
      combinedCondition = nextCondition ?? combinedCondition;
    }

    return baseQuery.where(combinedCondition).orderBy(asc(workflowSchedulesTable.name));
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const idFilter = eq(workflowSchedulesTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(workflowSchedulesTable.organizationId, organizationId));
  }
}
