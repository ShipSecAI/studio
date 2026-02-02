import { index, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import type { AuthRole } from '../../auth/types';
import { workflowsTable } from './workflows';

export const workflowRolesTable = pgTable(
  'workflow_roles',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflowsTable.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 191 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    role: text('role').$type<AuthRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workflowId, table.userId] }),
    orgIdx: index('workflow_roles_org_idx').on(table.organizationId, table.role),
    userIdx: index('workflow_roles_user_idx').on(table.userId),
  }),
);

export type WorkflowRoleRecord = typeof workflowRolesTable.$inferSelect;
