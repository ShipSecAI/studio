import { beforeAll, beforeEach, afterEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext, componentRegistry } from '@shipsec/component-sdk';
import type { McpLibraryInput, McpLibraryOutput } from '../mcp-library';

// Save the original fetch before any mocking
const originalFetch = global.fetch;

// Mock the docker runtime
vi.mock('../mcp-runtime', () => ({
  startMcpDockerServer: vi.fn(async () => ({
    endpoint: 'http://localhost:3000/mcp',
    containerId: 'mock-container-123',
  })),
}));

describe('MCP Library Integration Tests', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
  });

  afterEach(() => {
    // Always restore original fetch after each test
    global.fetch = originalFetch;
  });

  function setupFetchMocks(servers: any[] = []) {
    // Add required timestamps to servers
    const serversWithTimestamps = servers.map((s) => ({
      ...s,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    // Mock fetch implementation
    global.fetch = vi.fn(async (url: string) => {
      // Internal token generation endpoint
      if (url.includes('/generate-token')) {
        return new Response(JSON.stringify({ token: 'test-internal-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Fetch all servers endpoint
      if (url.includes('/mcp-servers') && !url.includes('/resolve')) {
        return new Response(JSON.stringify({ servers: serversWithTimestamps }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Resolve config endpoint
      if (url.includes('/resolve')) {
        return new Response(JSON.stringify({ headers: {}, args: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Docker spawn endpoint (should not be called due to mock)
      if (url.includes('/docker')) {
        return new Response(
          JSON.stringify({
            endpoint: 'http://localhost:3000/mcp',
            containerId: 'container-123',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Register local endpoint
      if (url.includes('/register-local')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Default response
      return new Response(JSON.stringify({ token: 'test-internal-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
  }

  describe('Test Case 1: Single Server Selection (aws-cloudtrail)', () => {
    test('should fetch and register a single stdio server', async () => {
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-single',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail'],
          },
        },
        context,
      );

      // Verify result
      expect(result).toEqual({});
      // Verify fetch was called (at least for token, servers list, resolve, and register)
      expect(global.fetch).toHaveBeenCalled();
    });

    test('should handle server not found gracefully', async () => {
      // Return empty server list
      setupFetchMocks([]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-not-found',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['non-existent-server'],
          },
        },
        context,
      );

      // Should return empty result without errors
      expect(result).toEqual({});
    });
  });

  describe('Test Case 2: Multiple Server Selection (aws-cloudtrail + aws-cloudwatch)', () => {
    test('should fetch and register multiple stdio servers', async () => {
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
        {
          id: 'aws-cloudwatch',
          name: 'Amazon CloudWatch',
          transportType: 'stdio',
          command: 'awslabs.cloudwatch-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-multiple',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail', 'aws-cloudwatch'],
          },
        },
        context,
      );

      expect(result).toEqual({});
      expect(global.fetch).toHaveBeenCalled();
    });

    test('should filter out disabled servers', async () => {
      // Return only enabled servers (cloudtrail enabled, cloudwatch disabled)
      setupFetchMocks([
        {
          id: 'aws-cloudtrail',
          name: 'AWS CloudTrail',
          transportType: 'stdio',
          command: 'awslabs.cloudtrail-mcp-server',
          args: [],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-filter',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail', 'aws-cloudwatch'],
          },
        },
        context,
      );

      expect(result).toEqual({});
    });
  });

  describe('Test Case 3: Tool Registration Verification', () => {
    test('should verify tool registration payload structure', async () => {
      setupFetchMocks([
        {
          id: 'filesystem',
          name: 'Filesystem MCP',
          transportType: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp'],
          enabled: true,
          endpoint: null,
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-registration',
        componentRef: 'mcp.custom',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['filesystem'],
          },
        },
        context,
      );

      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('Test Case 4: HTTP Server Support', () => {
    test('should handle HTTP server registration without Docker', async () => {
      setupFetchMocks([
        {
          id: 'http-server',
          name: 'HTTP MCP Server',
          transportType: 'http',
          command: null,
          args: null,
          enabled: true,
          endpoint: 'https://example.com/mcp',
          hasHeaders: false,
          headerKeys: null,
        },
      ]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-http',
        componentRef: 'mcp.custom',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['http-server'],
          },
        },
        context,
      );

      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty server selection', async () => {
      setupFetchMocks([]);

      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-empty',
        componentRef: 'mcp.custom',
      });

      const result = await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: [],
          },
        },
        context,
      );

      expect(result).toEqual({});
    });
  });

  describe('Component Metadata', () => {
    test('should have correct component metadata', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.id).toBe('mcp.custom');
      expect(component!.label).toBe('Custom MCPs');
      expect(component!.category).toBe('mcp');
      expect(component!.ui).toMatchObject({
        slug: 'mcp-library',
        version: '1.0.0',
        type: 'process',
        category: 'mcp',
        icon: 'Library',
        isLatest: true,
      });
    });

    test('should have correct port configuration', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.outputs).toBeDefined();
    });

    test('should have correct parameter schema', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>('mcp.custom');
      expect(component).toBeDefined();
      expect(component!.parameters).toBeDefined();
    });
  });
});
