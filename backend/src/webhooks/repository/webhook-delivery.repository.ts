import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  type WebhookDeliveryInsert,
  type WebhookDeliveryRecord,
  webhookDeliveriesTable,
} from '../../database/schema';

@Injectable()
export class WebhookDeliveryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(values: Omit<WebhookDeliveryInsert, 'id'>): Promise<WebhookDeliveryRecord> {
    const [record] = await this.db.insert(webhookDeliveriesTable).values(values).returning();
    return record;
  }

  async update(
    id: string,
    values: Partial<WebhookDeliveryInsert>,
  ): Promise<WebhookDeliveryRecord | undefined> {
    const [record] = await this.db
      .update(webhookDeliveriesTable)
      .set(values)
      .where(eq(webhookDeliveriesTable.id, id))
      .returning();
    return record;
  }

  async findById(id: string): Promise<WebhookDeliveryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(webhookDeliveriesTable)
      .where(eq(webhookDeliveriesTable.id, id))
      .limit(1);
    return record;
  }

  async findByRunId(runId: string): Promise<WebhookDeliveryRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(webhookDeliveriesTable)
      .where(eq(webhookDeliveriesTable.workflowRunId, runId))
      .limit(1);
    return record;
  }

  async listByWebhookId(webhookId: string, limit = 100): Promise<WebhookDeliveryRecord[]> {
    return this.db
      .select()
      .from(webhookDeliveriesTable)
      .where(eq(webhookDeliveriesTable.webhookId, webhookId))
      .orderBy(desc(webhookDeliveriesTable.createdAt))
      .limit(limit);
  }
}
