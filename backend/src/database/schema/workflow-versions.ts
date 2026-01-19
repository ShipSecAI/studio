import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

export type WorkflowVersionGraph = z.infer<typeof WorkflowGraphSchema>;

export const workflowVersionsTable = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull(),
    version: integer('version').notNull(),
    graph: jsonb('graph').$type<WorkflowVersionGraph>().notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    compiledDefinition: jsonb('compiled_definition')
      .$type<WorkflowDefinition | null>()
      .default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    workflowVersionUniqueIdx: uniqueIndex('workflow_versions_workflow_version_uidx').on(
      table.workflowId,
      table.version,
    ),
  }),
);

export type WorkflowVersionRecord = typeof workflowVersionsTable.$inferSelect;
