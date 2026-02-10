import { describe, it, expect, beforeEach } from 'bun:test';
import { ToolRegistryService } from '../tool-registry.service';
import type { SecretsEncryptionService } from '../../secrets/secrets.encryption';

// Mock Redis
class MockRedis {
  private data = new Map<string, Map<string, string>>();
  private kv = new Map<string, string>();

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

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    this.kv.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.data.delete(key);
    this.kv.delete(key);
    return 1;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async quit(): Promise<void> { }
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
    service = new ToolRegistryService(redis as any, encryption as any as SecretsEncryptionService);
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

  describe('registerMcpServer', () => {
    it('registers an MCP server with pre-discovered tools', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-library',
        serverName: 'Test Server',
        transport: 'http',
        endpoint: 'http://localhost:8080/mcp',
        tools: [
          { name: 'search', description: 'Search documents', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
          { name: 'analyze', description: 'Analyze data' },
        ],
      });

      // Verify server entry is stored
      const tool = await service.getTool('run-1', 'mcp-library');
      expect(tool).not.toBeNull();
      expect(tool?.toolName).toBe('Test Server');
      expect(tool?.type).toBe('remote-mcp');
      expect(tool?.status).toBe('ready');
      expect(tool?.endpoint).toBe('http://localhost:8080/mcp');
    });

    it('stores pre-discovered tools in separate Redis key', async () => {
      const discoveredTools = [
        { name: 'fetch', description: 'Fetch data', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
        { name: 'store', description: 'Store data', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } } },
      ];

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'my-mcp-server',
        serverName: 'My MCP Server',
        transport: 'stdio',
        endpoint: 'http://localhost:9999',
        containerId: 'container-abc',
        tools: discoveredTools,
      });

      // Verify tools are retrievable via getServerTools
      const tools = await service.getServerTools('run-1', 'my-mcp-server');
      expect(tools).not.toBeNull();
      expect(tools?.length).toBe(2);
      expect(tools?.[0].name).toBe('fetch');
      expect(tools?.[0].inputSchema).toEqual({ type: 'object', properties: { url: { type: 'string' } } });
      expect(tools?.[1].name).toBe('store');
    });

    it('registers stdio server with containerId', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'stdio-mcp',
        serverName: 'Steampipe',
        transport: 'stdio',
        endpoint: 'http://localhost:8080',
        containerId: 'container-123',
        tools: [{ name: 'query', description: 'Run SQL query' }],
      });

      const tool = await service.getTool('run-1', 'stdio-mcp');
      expect(tool?.type).toBe('mcp-server');  // stdio uses 'mcp-server' type
      expect(tool?.containerId).toBe('container-123');
    });

    it('encrypts headers when provided', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'auth-mcp',
        serverName: 'Auth MCP',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer secret-token' },
        tools: [],
      });

      const tool = await service.getTool('run-1', 'auth-mcp');
      expect(tool?.encryptedCredentials).toBeDefined();
    });
  });

  describe('getServerTools', () => {
    it('returns pre-discovered tools for a registered server', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'test-server',
        serverName: 'Test',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        tools: [
          { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
          { name: 'tool_b', description: 'Tool B' },
        ],
      });

      const tools = await service.getServerTools('run-1', 'test-server');
      expect(tools).toEqual([
        { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: 'Tool B' },
      ]);
    });

    it('returns null for unknown server', async () => {
      const tools = await service.getServerTools('run-1', 'unknown-server');
      expect(tools).toBeNull();
    });

    it('returns null for server without pre-discovered tools', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'empty-server',
        serverName: 'Empty',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        // No tools provided
      });

      const tools = await service.getServerTools('run-1', 'empty-server');
      expect(tools).toBeNull();
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
      expect(tools.map((t) => t.toolName).sort()).toEqual(['tool_a', 'tool_b']);
    });

    it('filters by exact nodeIds', async () => {
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

      const tools = await service.getToolsForRun('run-1', ['node-a']);
      expect(tools.length).toBe(1);
      expect(tools[0].toolName).toBe('tool_a');
    });

    it('includes child MCP servers via hierarchical nodeId matching', async () => {
      // Parent group component
      await service.registerComponentTool({
        runId: 'run-1',
        nodeId: 'aws-mcp-group',
        toolName: 'aws-mcp-group',
        componentId: 'mcp.group.aws',
        description: 'AWS MCP Group',
        inputSchema: { type: 'object', properties: {}, required: [] },
        credentials: {},
        exposedToAgent: false,
      });

      // Child MCP servers registered with hierarchical nodeIds
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group/aws-cloudtrail',
        serverName: 'aws-cloudtrail',
        transport: 'stdio',
        endpoint: 'http://localhost:8081',
        containerId: 'ct-container',
        tools: [{ name: 'lookup_events', description: 'Lookup CloudTrail events' }],
      });

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group/aws-cloudwatch',
        serverName: 'aws-cloudwatch',
        transport: 'stdio',
        endpoint: 'http://localhost:8082',
        containerId: 'cw-container',
        tools: [{ name: 'get_metrics', description: 'Get CloudWatch metrics' }],
      });

      // Unrelated node that should NOT be included
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'other-mcp-server',
        serverName: 'other',
        transport: 'stdio',
        endpoint: 'http://localhost:9090',
        tools: [{ name: 'other_tool' }],
      });

      // Filter by parent nodeId should include parent + children
      const tools = await service.getToolsForRun('run-1', ['aws-mcp-group']);
      expect(tools.length).toBe(3);
      expect(tools.map((t) => t.nodeId).sort()).toEqual([
        'aws-mcp-group',
        'aws-mcp-group/aws-cloudtrail',
        'aws-mcp-group/aws-cloudwatch',
      ]);
    });

    it('does not match partial nodeId prefixes without separator', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'aws-mcp-group-extra',
        serverName: 'extra',
        transport: 'stdio',
        endpoint: 'http://localhost:8083',
        tools: [{ name: 'extra_tool' }],
      });

      const tools = await service.getToolsForRun('run-1', ['aws-mcp-group']);
      expect(tools.length).toBe(0);
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

    it('decrypts MCP server headers as credentials', async () => {
      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-with-auth',
        serverName: 'Auth Server',
        transport: 'http',
        endpoint: 'http://localhost:8080',
        headers: { Authorization: 'Bearer my-token' },
        tools: [],
      });

      const creds = await service.getToolCredentials('run-1', 'mcp-with-auth');
      expect(creds).toEqual({ Authorization: 'Bearer my-token' });
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

      await service.registerMcpServer({
        runId: 'run-1',
        nodeId: 'mcp-server',
        serverName: 'Steampipe',
        transport: 'stdio',
        endpoint: 'http://localhost:8080',
        containerId: 'container-123',
        tools: [{ name: 'query' }],
      });

      const containerIds = await service.cleanupRun('run-1');
      expect(containerIds).toEqual(['container-123']);

      const tools = await service.getToolsForRun('run-1');
      expect(tools.length).toBe(0);
    });
  });
});
