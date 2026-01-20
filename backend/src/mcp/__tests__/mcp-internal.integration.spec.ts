import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { McpModule } from '../mcp.module';
import { TOOL_REGISTRY_REDIS } from '../tool-registry.service';
import { Pool } from 'pg';

// Simple Mock Redis
class MockRedis {
  data = new Map<string, Map<string, string>>();
  async hset(key: string, field: string, value: string) {
    if (!this.data.has(key)) this.data.set(key, new Map());
    this.data.get(key)!.set(field, value);
    return 1;
  }
  async hget(key: string, field: string) {
    return this.data.get(key)?.get(field) || null;
  }
  async quit() {}
}

describe('MCP Internal API (Integration)', () => {
  let app: INestApplication;
  let redis: MockRedis;
  const INTERNAL_TOKEN = 'test-internal-token';

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;
    process.env.NODE_ENV = 'test';
    process.env.SKIP_INGEST_SERVICES = 'true';
    process.env.SHIPSEC_SKIP_MIGRATION_CHECK = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [McpModule],
    })
      .overrideProvider(Pool)
      .useValue({
        connect: async () => ({
          query: async () => ({ rows: [] }),
          release: () => {},
        }),
        on: () => {},
      })
      .overrideProvider(TOOL_REGISTRY_REDIS)
      .useValue(new MockRedis())
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    redis = moduleFixture.get(TOOL_REGISTRY_REDIS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a component tool via internal API', async () => {
    const payload = {
      runId: 'run-test-1',
      nodeId: 'node-test-1',
      toolName: 'test_tool',
      componentId: 'core.test',
      description: 'Test Tool',
      inputSchema: { type: 'object', properties: {} },
      credentials: { apiKey: 'secret' },
    };

    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-component')
      .set('x-internal-token', INTERNAL_TOKEN)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true });

    // Verify it's in Redis
    const toolJson = await redis.hget('mcp:run:run-test-1:tools', 'node-test-1');
    expect(toolJson).not.toBeNull();
    const tool = JSON.parse(toolJson!);
    expect(tool.toolName).toBe('test_tool');
    expect(tool.status).toBe('ready');
  });

  it('rejects identity-less internal requests', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/mcp/register-component')
      .send({});

    // Should be caught by global AuthGuard
    expect(response.status).toBe(403);
  });
});
