import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const billingUsageEvents = pgTable(
  'billing_usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: varchar('idempotency_key', { length: 191 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    channel: varchar('channel', { length: 64 }).notNull(),
    meterKey: varchar('meter_key', { length: 64 }).notNull(),
    units: bigint('units', { mode: 'number' }).notNull(),
    model: varchar('model', { length: 191 }),
    provider: varchar('provider', { length: 64 }),
    workflowId: uuid('workflow_id'),
    runId: text('run_id'),
    nodeRef: text('node_ref'),
    agentRunId: text('agent_run_id'),
    actorId: varchar('actor_id', { length: 191 }),
    requestId: text('request_id'),
    traceId: text('trace_id'),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    pricingVersion: varchar('pricing_version', { length: 32 }),
    settlementStatus: varchar('settlement_status', { length: 32 }).notNull().default('pending'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown> | null>(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('billing_usage_events_idempotency_unique').on(
      table.idempotencyKey,
    ),
    orgOccurredIdx: index('billing_usage_events_org_occurred_idx').on(
      table.organizationId,
      table.occurredAt,
    ),
    orgRunOccurredIdx: index('billing_usage_events_org_run_occurred_idx').on(
      table.organizationId,
      table.runId,
      table.occurredAt,
    ),
    orgWorkflowOccurredIdx: index('billing_usage_events_org_workflow_occurred_idx').on(
      table.organizationId,
      table.workflowId,
      table.occurredAt,
    ),
    orgChannelOccurredIdx: index('billing_usage_events_org_channel_occurred_idx').on(
      table.organizationId,
      table.channel,
      table.occurredAt,
    ),
    requestIdx: index('billing_usage_events_request_idx').on(table.organizationId, table.requestId),
  }),
);

export type BillingUsageEventRecord = typeof billingUsageEvents.$inferSelect;
