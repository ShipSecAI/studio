import { pgTable, uuid, varchar, bigint, timestamp } from 'drizzle-orm/pg-core';

/**
 * Files table schema (synced with backend schema)
 */
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  storageKey: varchar('storage_key', { length: 500 }).notNull().unique(),
  organizationId: varchar('organization_id', { length: 191 }),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

