import { sql } from 'drizzle-orm';
import {
  boolean,
  decimal,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const asmDomains = pgTable(
  'asm_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
    scopeInclude: text('scope_include').array(),
    scopeExclude: text('scope_exclude').array(),
    monitoringEnabled: boolean('monitoring_enabled').default(false),
    frequency: varchar('frequency', { length: 50 }),
    lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgDomainUnique: uniqueIndex('asm_domains_org_domain_unique')
      .on(table.organizationId, table.domain)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type AsmDomain = typeof asmDomains.$inferSelect;
export type NewAsmDomain = typeof asmDomains.$inferInsert;

export const asmAssets = pgTable(
  'asm_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    domainId: uuid('domain_id')
      .notNull()
      .references(() => asmDomains.id, { onDelete: 'cascade' }),
    hostname: varchar('hostname', { length: 512 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    ipAddresses: text('ip_addresses').array(),
    techStack: text('tech_stack').array(),
    ports: jsonb('ports').$type<{ port: number; protocol: string; service: string }[]>(),
    riskScore: decimal('risk_score', { precision: 4, scale: 1 }),
    dnsRecords: jsonb('dns_records').$type<Record<string, unknown>>(),
    tlsInfo: jsonb('tls_info').$type<Record<string, unknown>>(),
    firstSeen: timestamp('first_seen', { withTimezone: true }).defaultNow().notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => ({
    domainHostnameUnique: unique().on(table.domainId, table.hostname),
  }),
);

export type AsmAsset = typeof asmAssets.$inferSelect;
export type NewAsmAsset = typeof asmAssets.$inferInsert;
