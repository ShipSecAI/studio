import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export const workflowsTable = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
