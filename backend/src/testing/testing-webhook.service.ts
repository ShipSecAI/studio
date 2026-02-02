import { Injectable } from '@nestjs/common';

export interface TestingWebhookRecord {
  id: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: string;
}

@Injectable()
export class TestingWebhookService {
  private readonly records: TestingWebhookRecord[] = [];

  record(record: TestingWebhookRecord): TestingWebhookRecord {
    this.records.push(record);
    return record;
  }

  list(): TestingWebhookRecord[] {
    return [...this.records];
  }

  latest(): TestingWebhookRecord | undefined {
    return this.records.at(-1);
  }

  clear(): void {
    this.records.length = 0;
  }
}
