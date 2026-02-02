import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import { workflowRolesTable, type WorkflowRoleRecord } from '../../database/schema';
import type { AuthRole } from '../../auth/types';

export interface WorkflowRoleUpsertInput {
  workflowId: string;
  userId: string;
  role: AuthRole;
  organizationId?: string | null;
}

export interface WorkflowRoleCheckInput {
  workflowId: string;
  userId: string;
  role: AuthRole;
  organizationId?: string | null;
}

@Injectable()
export class WorkflowRoleRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsert(input: WorkflowRoleUpsertInput): Promise<void> {
    const now = new Date();
    await this.db
      .insert(workflowRolesTable)
      .values({
        workflowId: input.workflowId,
        userId: input.userId,
        role: input.role,
        organizationId: input.organizationId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [workflowRolesTable.workflowId, workflowRolesTable.userId],
        set: {
          role: input.role,
          organizationId: input.organizationId ?? null,
          updatedAt: now,
        },
      });
  }

  async hasRole(input: WorkflowRoleCheckInput): Promise<boolean> {
    const conditions = [
      eq(workflowRolesTable.workflowId, input.workflowId),
      eq(workflowRolesTable.userId, input.userId),
      eq(workflowRolesTable.role, input.role),
    ];

    if (input.organizationId) {
      conditions.push(eq(workflowRolesTable.organizationId, input.organizationId));
    }

    const [record] = await this.db
      .select()
      .from(workflowRolesTable)
      .where(and(...conditions))
      .limit(1);

    return Boolean(record);
  }

  async listForWorkflow(workflowId: string): Promise<WorkflowRoleRecord[]> {
    return this.db
      .select()
      .from(workflowRolesTable)
      .where(eq(workflowRolesTable.workflowId, workflowId));
  }
}
