import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { files, NewFile, File } from '../database/schema/files.schema';
import type { SQL } from 'drizzle-orm';

export interface FileQueryOptions {
  organizationId?: string | null;
}

@Injectable()
export class FilesRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: NewFile): Promise<File> {
    const [file] = await this.db
      .insert(files)
      .values({
        ...data,
      })
      .returning();
    return file;
  }

  async findById(id: string, options: FileQueryOptions = {}): Promise<File | null> {
    const conditions: SQL[] = [eq(files.id, id)];
    if (options.organizationId) {
      conditions.push(eq(files.organizationId, options.organizationId));
    }

    const [file] = await this.db
      .select()
      .from(files)
      .where(and(...conditions))
      .limit(1);
    return file ?? null;
  }

  async findByStorageKey(storageKey: string, options: FileQueryOptions = {}): Promise<File | null> {
    const conditions: SQL[] = [eq(files.storageKey, storageKey)];
    if (options.organizationId) {
      conditions.push(eq(files.organizationId, options.organizationId));
    }

    const [file] = await this.db
      .select()
      .from(files)
      .where(and(...conditions))
      .limit(1);
    return file ?? null;
  }

  async list(limit = 100, options: FileQueryOptions = {}): Promise<File[]> {
    const whereClause =
      options.organizationId !== undefined && options.organizationId !== null
        ? eq(files.organizationId, options.organizationId)
        : undefined;

    const baseQuery = this.db.select().from(files);
    const filteredQuery = whereClause ? baseQuery.where(whereClause) : baseQuery;
    return filteredQuery.limit(limit).orderBy(files.uploadedAt);
  }

  async delete(id: string, options: FileQueryOptions = {}): Promise<void> {
    const conditions: SQL[] = [eq(files.id, id)];
    if (options.organizationId) {
      conditions.push(eq(files.organizationId, options.organizationId));
    }

    await this.db.delete(files).where(and(...conditions));
  }
}
