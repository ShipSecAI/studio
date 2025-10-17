import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { files, NewFile, File } from '../database/schema/files.schema';

@Injectable()
export class FilesRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: NewFile): Promise<File> {
    const [file] = await this.db.insert(files).values(data).returning();
    return file;
  }

  async findById(id: string): Promise<File | null> {
    const [file] = await this.db.select().from(files).where(eq(files.id, id)).limit(1);
    return file ?? null;
  }

  async findByStorageKey(storageKey: string): Promise<File | null> {
    const [file] = await this.db
      .select()
      .from(files)
      .where(eq(files.storageKey, storageKey))
      .limit(1);
    return file ?? null;
  }

  async list(limit: number = 100): Promise<File[]> {
    return this.db.select().from(files).limit(limit).orderBy(files.uploadedAt);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(files).where(eq(files.id, id));
  }
}

