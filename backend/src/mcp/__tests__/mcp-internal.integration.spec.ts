import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthService } from '../../auth/auth.service';
import { AuthGuard } from '../../auth/auth.guard';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { OpenSearchTenantService } from '../../analytics/opensearch-tenant.service';
import { SecurityAnalyticsService } from '../../analytics/security-analytics.service';
import { OrganizationSettingsService } from '../../analytics/organization-settings.service';
import { AnalyticsModule } from '../../analytics/analytics.module';
import { AgentTraceIngestService } from '../../agent-trace/agent-trace-ingest.service';
import { EventIngestService } from '../../events/event-ingest.service';
import { LogIngestService } from '../../logging/log-ingest.service';
import { NodeIOIngestService } from '../../node-io/node-io-ingest.service';
import { SecretsEncryptionService } from '../../secrets/secrets.encryption';
import { InternalMcpController } from '../internal-mcp.controller';
import { McpGatewayService } from '../mcp-gateway.service';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from '../tool-registry.service';
import { Pool } from 'pg';

// Simple Mock Redis
class MockRedis {
  data = new Map<string, Map<string, string>>();
  kv = new Map<string, string>();
  async hset(key: string, field: string, value: string) {
    if (!this.data.has(key)) this.data.set(key, new Map());
    this.data.get(key)!.set(field, value);
    return 1;
  }
  async hget(key: string, field: string) {
    return this.data.get(key)?.get(field) || null;
  }
  async expire() {
    return 1;
  }
  async get(key: string) {
    return this.kv.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.kv.set(key, value);
    return 'OK';
  }
  async del(key: string) {
    return this.kv.delete(key) ? 1 : 0;
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
    process.env.SECRET_STORE_MASTER_KEY = '0123456789abcdef0123456789abcdef';

    const { McpModule } = await import('../mcp.module');
    const mockRedis = new MockRedis();
    const encryption = new SecretsEncryptionService();
    const toolRegistryService = new ToolRegistryService(mockRedis as unknown as any, encryption);
    const mockGatewayService = {
      refreshServersForRun: async () => {},
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), McpModule],
    })
      .overrideModule(AnalyticsModule)
      .useModule(
        class MockAnalyticsModule {
          static providers = [
            {
              provide: AnalyticsService,
              useValue: {
                isEnabled: () => false,
                track: () => {},
                trackWorkflowStarted: () => {},
                trackWorkflowCompleted: () => {},
                trackApiCall: () => {},
                trackComponentExecuted: () => {},
              },
            },
            {
              provide: OpenSearchTenantService,
              useValue: { provisionTenant: async () => true },
            },
            {
              provide: SecurityAnalyticsService,
              useValue: { indexDocument: async () => {}, bulkIndexDocuments: async () => {} },
            },
            {
              provide: OrganizationSettingsService,
              useValue: {
                getOrganizationSettings: async () => ({}),
                updateOrganizationSettings: async () => ({}),
              },
            },
          ];
        },
      )
      .overrideProvider(NodeIOIngestService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .overrideProvider(LogIngestService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .overrideProvider(EventIngestService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .overrideProvider(AgentTraceIngestService)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .overrideProvider(ToolRegistryService)
      .useValue(toolRegistryService)
      .overrideProvider(ApiKeysService)
      .useValue({
        validateKey: async () => null,
      })
      .overrideProvider(McpGatewayService)
      .useValue(mockGatewayService)
      .overrideProvider(AuthService)
      .useValue({
        authenticate: async () => {
          throw new ForbiddenException('Unauthorized');
        },
        providerName: 'local',
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
      .useValue(mockRedis)
      .compile();

    app = moduleFixture.createNestApplication();
    const authService = moduleFixture.get(AuthService);
    const apiKeysService = moduleFixture.get(ApiKeysService);
    const reflector = moduleFixture.get(Reflector);
    app.useGlobalGuards(new AuthGuard(authService, apiKeysService, reflector));
    await app.init();

    redis = moduleFixture.get(TOOL_REGISTRY_REDIS);
    const controller = moduleFixture.get(InternalMcpController);
    (controller as unknown as { toolRegistry: ToolRegistryService }).toolRegistry =
      toolRegistryService;
    (controller as unknown as { mcpGatewayService: typeof mockGatewayService }).mcpGatewayService =
      mockGatewayService;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
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
