import { pgTable, uuid, text, varchar, bigint, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

import { files } from './files.schema';

export const artifactsTable = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: text('run_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    workflowVersionId: uuid('workflow_version_id'),
    componentId: text('component_id'),
    componentRef: text('component_ref').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: varchar('mime_type', { length: 150 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    destinations: jsonb('destinations').$type<('run' | 'library')[]>().notNull().default(['run']),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    organizationId: varchar('organization_id', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('artifacts_run_idx').on(table.runId, table.createdAt),
  }),
);

export type ArtifactRecord = typeof artifactsTable.$inferSelect;
export type NewArtifactRecord = typeof artifactsTable.$inferInsert;
