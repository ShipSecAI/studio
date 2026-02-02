import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Stores the inputs and outputs of each node execution for inspection and debugging.
 *
 * For small payloads (< 100KB), data is stored inline as JSONB.
 * For large payloads, data is spilled to object storage and a reference is stored.
 */
export const nodeIOTable = pgTable(
  'node_io',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    nodeRef: text('node_ref').notNull(),
    workflowId: text('workflow_id'),
    organizationId: varchar('organization_id', { length: 191 }),
    componentId: text('component_id').notNull(),

    // Inputs received by this node
    inputs: jsonb('inputs').$type<Record<string, unknown>>(),
    inputsSize: integer('inputs_size').notNull().default(0),
    inputsSpilled: boolean('inputs_spilled').notNull().default(false),
    inputsStorageRef: text('inputs_storage_ref'), // Object storage path if spilled

    // Outputs produced by this node
    outputs: jsonb('outputs').$type<Record<string, unknown>>(),
    outputsSize: integer('outputs_size').notNull().default(0),
    outputsSpilled: boolean('outputs_spilled').notNull().default(false),
    outputsStorageRef: text('outputs_storage_ref'), // Object storage path if spilled

    // Metadata
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    status: text('status')
      .$type<'running' | 'completed' | 'failed' | 'skipped'>()
      .notNull()
      .default('running'),
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runNodeIndex: uniqueIndex('node_io_run_node_idx').on(table.runId, table.nodeRef),
    runIndex: index('node_io_run_idx').on(table.runId),
    workflowIndex: index('node_io_workflow_idx').on(table.workflowId),
  }),
);

export type NodeIORecord = typeof nodeIOTable.$inferSelect;
export type NodeIOInsert = typeof nodeIOTable.$inferInsert;
