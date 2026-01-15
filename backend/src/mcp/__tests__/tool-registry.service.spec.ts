import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from '../tool-registry.service';
import type { SecretsEncryptionService } from '../../secrets/secrets.encryption';

// Mock Redis
class MockRedis {
  private data: Map<string, Map<string, string>> = new Map();

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }
    this.data.get(key)!.set(field, value);
    return 1;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.data.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.data.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async del(key: string): Promise<number> {
    this.data.delete(key);
    return 1;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async quit(): Promise<void> {}
}

// Mock encryption service
class MockEncryptionService {
  async encrypt(value: string): Promise<{ ciphertext: string; keyId: string }> {
    return {
      ciphertext: Buffer.from(value).toString('base64'),
      keyId: 'test-key',
    };
  }

  async decrypt(material: { ciphertext: string }): Promise<string> {
    return Buffer.from(material.ciphertext, 'base64').toString('utf-8');
  }
}

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;
  let redis: MockRedis;
  let encryption: MockEncryptionService;

  beforeEach(() => {
    redis = new MockRedis();
    encryption = new MockEncryptionService();
    service = new ToolRegistryService(
      redis as any,
      encryption as any as SecretsEncryptionService,
    );
  });

  describe('registerComponentTool', () => {
    it('registers a component tool with encrypted credentials', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'check_ip_reputation',
        componentId: 'security.abuseipdb',
        description: 'Check IP reputation',
        inputSchema: {
          type: 'object',
          properties: { ipAddress: { type: 'string' } },
          required: ['ipAddress'],
        },
        credentials: { apiKey: 'secret-123' },
      });

      const tool = await service.getTool('run-1', 'node-a');
      expect(tool).not.toBeNull();
      expect(tool?.toolName).toBe('check_ip_reputation');
      expect(tool?.status).toBe('ready');
      expect(tool?.type).toBe('component');
      expect(tool?.encryptedCredentials).toBeDefined();
    });
  });

  describe('getToolsForRun', () => {
    it('returns all tools for a run', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-b',
        toolName: 'tool_b',
        componentId: 'comp.b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const tools = await service.getToolsForRun('run-1');
      expect(tools.length).toBe(2);
      expect(tools.map(t => t.toolName).sort()).toEqual(['tool_a', 'tool_b']);
    });
  });

  describe('getToolByName', () => {
    it('finds a tool by name', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'my_tool',
        componentId: 'comp.a',
        description: 'My Tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const tool = await service.getToolByName('run-1', 'my_tool');
      expect(tool).not.toBeNull();
      expect(tool?.nodeId).toBe('node-a');
    });

    it('returns null for unknown tool name', async () => {
      const tool = await service.getToolByName('run-1', 'unknown');
      expect(tool).toBeNull();
    });
  });

  describe('getToolCredentials', () => {
    it('decrypts and returns credentials', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool',
        componentId: 'comp',
        description: 'Tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: { apiKey: 'secret-value', token: 'another-secret' },
      });

      const creds = await service.getToolCredentials('run-1', 'node-a');
      expect(creds).toEqual({ apiKey: 'secret-value', token: 'another-secret' });
    });
  });

  describe('areAllToolsReady', () => {
    it('returns true when all required tools are ready', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-b',
        toolName: 'tool_b',
        componentId: 'comp.b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const ready = await service.areAllToolsReady('run-1', ['node-a', 'node-b']);
      expect(ready).toBe(true);
    });

    it('returns false when a required tool is missing', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      const ready = await service.areAllToolsReady('run-1', ['node-a', 'node-b']);
      expect(ready).toBe(false);
    });
  });

  describe('cleanupRun', () => {
    it('removes all tools and returns container IDs', async () => {
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'node-a',
        toolName: 'tool_a',
        componentId: 'comp.a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
      });

      await service.registerLocalMcp({
        runId: 'run-1',
        nodeId: 'node-mcp',
        toolName: 'steampipe',
        description: 'Steampipe MCP',
        inputSchema: { type: 'object', properties: {}, required: [] },
        endpoint: 'http://localhost:8080',
        containerId: 'container-123',
      });

      const containerIds = await service.cleanupRun('run-1');
      expect(containerIds).toEqual(['container-123']);

      const tools = await service.getToolsForRun('run-1');
      expect(tools.length).toBe(0);
    });
  });
});
