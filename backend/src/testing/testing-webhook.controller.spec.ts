import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { TestingSupportModule } from './testing.module';

describe('TestingWebhookController (standalone)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestingSupportModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await request(app.getHttpServer()).delete('/testing/webhooks').expect(200);
  });

  it('accepts arbitrary webhook payloads and exposes them for inspection', async () => {
    const payload = { hello: 'world' };

    const postResponse = await request(app.getHttpServer())
      .post('/testing/webhooks')
      .set('x-test-header', 'abc123')
      .send(payload)
      .expect(201);

    expect(postResponse.body.id).toBeDefined();
    expect(typeof postResponse.body.receivedAt).toBe('string');

    const listResponse = await request(app.getHttpServer())
      .get('/testing/webhooks')
      .expect(200);

    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0]).toMatchObject({
      id: postResponse.body.id,
      method: 'POST',
      headers: expect.objectContaining({ 'x-test-header': 'abc123' }),
      body: payload,
    });

    const latestResponse = await request(app.getHttpServer())
      .get('/testing/webhooks/latest')
      .expect(200);

    expect(latestResponse.body.id).toBe(postResponse.body.id);
  });

  it('retrieves specific webhook invocations by id', async () => {
    const { body: first } = await request(app.getHttpServer())
      .post('/testing/webhooks')
      .send({ index: 1 })
      .expect(201);
    const { body: second } = await request(app.getHttpServer())
      .post('/testing/webhooks')
      .send({ index: 2 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/testing/webhooks/${first.id}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/testing/webhooks/${second.id}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete('/testing/webhooks')
      .expect(200, { cleared: 2 });

    await request(app.getHttpServer())
      .get('/testing/webhooks/latest')
      .expect(404);
  });

  it('can simulate non-2xx responses and delays', async () => {
    const start = Date.now();
    await request(app.getHttpServer())
      .post('/testing/webhooks?status=503&delayMs=50')
      .send({ test: true })
      .expect(503);

    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
