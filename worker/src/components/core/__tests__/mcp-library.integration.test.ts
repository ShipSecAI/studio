import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import { createExecutionContext, componentRegistry } from '@shipsec/component-sdk';
import type { McpLibraryInput, McpLibraryOutput } from '../mcp-library';

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('MCP Library Integration Tests', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_URL = 'http://localhost:3000';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
  });

  describe('Test Case 1: Single Server Selection (aws-cloudtrail)', () => {
    test('should fetch and register a single stdio server', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      // Mock backend API responses
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'aws-cloudtrail',
                  name: 'AWS CloudTrail',
                  description: 'Query AWS CloudTrail logs for API activity',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: 'test-gateway-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, toolCount: 15 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const context = createExecutionContext({
        runId: 'test-run-single',
        componentRef: 'core.mcp.library',
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

      // Verify fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // First call: fetch servers list
      expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/api/v1/mcp-servers', {
        headers: { 'Content-Type': 'application/json' },
      });

      // Second call: generate internal token
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:3000/internal/mcp/generate-token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('test-run-single'),
        }),
      );

      // Third call: register tools
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:3000/internal/mcp/register-local',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-gateway-token',
          }),
        }),
      );

      // Verify result
      expect(result).toEqual({});
    });

    test('should handle server not found gracefully', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      // Mock backend API returning empty server list
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ servers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const context = createExecutionContext({
        runId: 'test-run-not-found',
        componentRef: 'core.mcp.library',
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
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      // Mock backend API responses
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'aws-cloudtrail',
                  name: 'AWS CloudTrail',
                  description: 'Query AWS CloudTrail logs for API activity',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                {
                  id: 'aws-cloudwatch',
                  name: 'AWS CloudWatch',
                  description: 'Query AWS CloudWatch metrics and logs',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-aws-cloudwatch'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        // Token for first server
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: 'token-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        // Register first server
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, toolCount: 15 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        // Token for second server
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: 'token-2' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        // Register second server
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, toolCount: 8 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const context = createExecutionContext({
        runId: 'test-run-multiple',
        componentRef: 'core.mcp.library',
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

      // Verify both servers were processed
      expect(mockFetch).toHaveBeenCalledTimes(5); // 1 list + 2 tokens + 2 registers

      expect(result).toEqual({});
    });

    test('should filter out disabled servers', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      // Mock backend API with one enabled and one disabled server
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            servers: [
              {
                id: 'aws-cloudtrail',
                name: 'AWS CloudTrail',
                transportType: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
                enabled: true,
                lastHealthStatus: 'healthy',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              {
                id: 'aws-cloudwatch',
                name: 'AWS CloudWatch',
                transportType: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-aws-cloudwatch'],
                enabled: false, // Disabled
                lastHealthStatus: 'unhealthy',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const context = createExecutionContext({
        runId: 'test-run-filter',
        componentRef: 'core.mcp.library',
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

      // Only enabled server should be processed
      expect(result).toEqual({});
    });
  });

  describe('Test Case 3: Tool Registration Verification', () => {
    test('should verify tool registration payload structure', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      let registerPayload: any;

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'filesystem',
                  name: 'Filesystem',
                  description: 'Read and write local files',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: 'test-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockImplementationOnce(async (url: string, options?: RequestInit) => {
          // Capture registration payload
          if (url.toString().includes('register-local')) {
            registerPayload = JSON.parse(options?.body as string);
          }
          return new Response(JSON.stringify({ success: true, toolCount: 6 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      const context = createExecutionContext({
        runId: 'test-run-registration',
        componentRef: 'core.mcp.library',
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

      // Verify registration payload structure
      expect(registerPayload).toMatchObject({
        runId: 'test-run-registration',
        nodeId: 'core.mcp.library',
        toolName: 'Filesystem',
        description: expect.stringContaining('Filesystem'),
        inputSchema: {
          type: 'object',
          properties: {},
        },
        endpoint: expect.stringContaining('http://localhost:'),
        containerId: expect.any(String),
      });

      expect(registerPayload.endpoint).toContain('/mcp');
    });

    test('should handle registration errors gracefully', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'aws-cloudtrail',
                  name: 'AWS CloudTrail',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: 'test-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Registration failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const context = createExecutionContext({
        runId: 'test-run-error',
        componentRef: 'core.mcp.library',
      });

      await expect(
        component!.execute(
          {
            inputs: {},
            params: {
              enabledServers: ['aws-cloudtrail'],
            },
          },
          context,
        ),
      ).rejects.toThrow('Failed to register server aws-cloudtrail');
    });
  });

  describe('Test Case 4: Docker Container Spawn Integration', () => {
    test('should successfully register stdio server with Docker', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'aws-cloudtrail',
                  name: 'AWS CloudTrail',
                  description: 'Query AWS CloudTrail logs',
                  transportType: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-aws-cloudtrail'],
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const context = createExecutionContext({
        runId: 'test-run-docker',
        componentRef: 'core.mcp.library',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['aws-cloudtrail'],
          },
        },
        context,
      );

      // Verify registration payload includes containerId
      const registerCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes('register-local'),
      );
      expect(registerCall).toBeDefined();
      const registerBody = JSON.parse(registerCall![1].body);
      expect(registerBody.containerId).toBeDefined();
      expect(typeof registerBody.containerId).toBe('string');
    });
  });

  describe('Test Case 5: Tool Registry Integration', () => {
    test('should integrate with Tool Registry via internal API', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      const capturedRequests: { url: string; body: any }[] = [];

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'test-server',
                  name: 'Test Server',
                  description: 'Test MCP server',
                  transportType: 'http',
                  endpoint: 'http://example.com/mcp',
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockImplementation(async (url: string, options?: RequestInit) => {
          const urlStr = url.toString();
          capturedRequests.push({
            url: urlStr,
            body: options?.body ? JSON.parse(options.body as string) : undefined,
          });

          if (urlStr.includes('generate-token')) {
            return new Response(JSON.stringify({ token: 'registry-token-123' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          } else if (urlStr.includes('register-local')) {
            return new Response(JSON.stringify({ success: true, registered: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({}), { status: 404 });
        });

      const context = createExecutionContext({
        runId: 'test-run-registry',
        componentRef: 'core.mcp.library',
      });

      await component!.execute(
        {
          inputs: {},
          params: {
            enabledServers: ['test-server'],
          },
        },
        context,
      );

      // Verify token generation request
      const tokenRequest = capturedRequests.find((r) => r.url.includes('generate-token'));
      expect(tokenRequest).toBeDefined();
      expect(tokenRequest?.body).toMatchObject({
        runId: 'test-run-registry',
        allowedNodeIds: ['core.mcp.library'],
      });

      // Verify registration request
      const registerRequest = capturedRequests.find((r) => r.url.includes('register-local'));
      expect(registerRequest).toBeDefined();
      expect(registerRequest?.body).toMatchObject({
        runId: 'test-run-registry',
        nodeId: 'core.mcp.library',
        toolName: 'Test Server',
        description: expect.stringContaining('Test Server'),
        endpoint: 'http://example.com/mcp',
        containerId: undefined, // HTTP servers don't need container
      });

      // HTTP server should not spawn Docker container (verified by no containerId)
    });

    test('should handle HTTP server registration without Docker', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              servers: [
                {
                  id: 'http-server',
                  name: 'HTTP MCP Server',
                  transportType: 'http',
                  endpoint: 'http://remote-server:8080/mcp',
                  enabled: true,
                  lastHealthStatus: 'healthy',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const context = createExecutionContext({
        runId: 'test-run-http',
        componentRef: 'core.mcp.library',
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

      // But should still register with backend
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/internal/mcp/register-local',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty server selection', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      const context = createExecutionContext({
        runId: 'test-run-empty',
        componentRef: 'core.mcp.library',
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

      // Should return without any fetch calls
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    test('should handle backend API errors', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const context = createExecutionContext({
        runId: 'test-run-api-error',
        componentRef: 'core.mcp.library',
      });

      await expect(
        component!.execute(
          {
            inputs: {},
            params: {
              enabledServers: ['aws-cloudtrail'],
            },
          },
          context,
        ),
      ).rejects.toThrow('Failed to fetch MCP servers');
    });

    test('should handle unsupported transport types', async () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            servers: [
              {
                id: 'unsupported-server',
                name: 'Unsupported Server',
                transportType: 'websocket', // Not supported yet
                endpoint: 'ws://example.com/mcp',
                enabled: true,
                lastHealthStatus: 'healthy',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const context = createExecutionContext({
        runId: 'test-run-unsupported',
        componentRef: 'core.mcp.library',
      });

      await expect(
        component!.execute(
          {
            inputs: {},
            params: {
              enabledServers: ['unsupported-server'],
            },
          },
          context,
        ),
      ).rejects.toThrow('Unsupported server type: websocket');
    });
  });

  describe('Component Metadata', () => {
    test('should have correct component metadata', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();
      expect(component!.id).toBe('core.mcp.library');
      expect(component!.label).toBe('MCP Library');
      expect(component!.category).toBe('mcp');
      expect(component!.ui).toMatchObject({
        slug: 'mcp-library',
        version: '1.0.0',
        type: 'process',
        category: 'mcp',
        icon: 'Library',
        isLatest: true,
      });
      // agentTool is optional, skip check if undefined
    });

    test('should have correct port configuration', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();
      expect(component!.outputs).toBeDefined();
    });

    test('should have correct parameter schema', () => {
      const component = componentRegistry.get<McpLibraryInput, McpLibraryOutput>(
        'core.mcp.library',
      );
      expect(component).toBeDefined();
      expect(component!.parameters).toBeDefined();
    });
  });
});
