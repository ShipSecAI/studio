import 'reflect-metadata';

import { beforeEach, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';

import { TestingWebhookController } from './testing-webhook.controller';
import { TestingWebhookService, TestingWebhookRecord } from './testing-webhook.service';
import { TestingSupportModule } from './testing.module';
import { AcceptWebhookQuerySchema } from './dto/testing-webhook.dto';

const createMockRequest = (overrides: Partial<Record<string, unknown>> = {}) => ({
  method: overrides.method ?? 'POST',
  path: overrides.path ?? '/testing/webhooks',
  query: overrides.query ?? {},
  headers: overrides.headers ?? {},
} as any);

const createMockResponse = () => {
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
};

describe('TestingWebhookController', () => {
  let controller: TestingWebhookController;
  let service: TestingWebhookService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestingSupportModule],
    }).compile();

    controller = moduleRef.get(TestingWebhookController);
    service = moduleRef.get(TestingWebhookService);
    service.clear();
  });

  it('accepts arbitrary webhook payloads and records them', async () => {
    const body = { hello: 'world' };
    const headers = { 'x-test-header': 'abc123' };
    const request = createMockRequest({ headers });
    const response = createMockResponse();
    const query = AcceptWebhookQuerySchema.parse({});

    const record = await controller.acceptWebhook(body, headers, request, query, response);

    expect(record.id).toBeDefined();
    expect(typeof record.receivedAt).toBe('string');
    expect(response.statusCode).toBe(201);

    const all = controller.listRecords();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject<Partial<TestingWebhookRecord>>({
      id: record.id,
      method: 'POST',
      body,
      headers: expect.objectContaining({ 'x-test-header': 'abc123' }),
    });

    const latest = controller.latestRecord();
    expect(latest.id).toBe(record.id);
  });

  it('retrieves specific webhook records and clears history', async () => {
    const response = createMockResponse();
    const query = AcceptWebhookQuerySchema.parse({});

    const first = await controller.acceptWebhook(
      { index: 1 },
      {},
      createMockRequest(),
      query,
      response,
    );
    const second = await controller.acceptWebhook(
      { index: 2 },
      {},
      createMockRequest(),
      query,
      response,
    );

    const fetchedFirst = controller.getRecord(first.id);
    expect(fetchedFirst.body).toEqual({ index: 1 });

    const fetchedSecond = controller.getRecord(second.id);
    expect(fetchedSecond.body).toEqual({ index: 2 });

    const clearResult = controller.clearRecords();
    expect(clearResult).toEqual({ cleared: 2 });
    expect(() => controller.latestRecord()).toThrow('No webhook calls recorded yet');
  });

  it('honours custom status codes and delays', async () => {
    const response = createMockResponse();
    const query = AcceptWebhookQuerySchema.parse({ status: 503, delayMs: 0 });
    const start = Date.now();

    const record = await controller.acceptWebhook(
      { test: true },
      {},
      createMockRequest(),
      query,
      response,
    );

    expect(record.id).toBeDefined();
    expect(response.statusCode).toBe(503);
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
});
