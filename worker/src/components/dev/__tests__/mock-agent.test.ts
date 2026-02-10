import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';

function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    runId: 'test-run',
    componentRef: 'mock.agent',
    logger: {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
    },
    emitProgress: () => {},
    metadata: {
      runId: 'test-run',
      componentRef: 'mock.agent',
    },
    http: {
      fetch: async (input, init) => globalThis.fetch(input as any, init),
      toCurl: () => '',
    },
    ...overrides,
  };
}

beforeAll(async () => {
  await import('../../index');
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
});

describe('mock.agent', () => {
  test('returns empty list when no connected tools', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      createTestContext(),
    );

    expect(result).toEqual({ discoveredTools: [], toolCount: 0 });
  });

  test('discovers tools from gateway when connected tools exist', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    const mockListTools = vi.fn().mockResolvedValue({
      tools: [
        { name: 'aws-cloudtrail__lookup_events', description: 'Look up CloudTrail events' },
        { name: 'aws-s3__list_buckets', description: 'List S3 buckets' },
      ],
    });
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    class MockClient {
      connect = mockConnect;
      listTools = mockListTools;
      close = mockClose;
    }

    class MockTransport {
      constructor(
        public url: URL,
        public options: any,
      ) {}
    }

    const mockGetToken = vi.fn().mockResolvedValue('mock-gateway-token');

    const context = createTestContext({
      metadata: {
        runId: 'test-run',
        componentRef: 'mock.agent',
        connectedToolNodeIds: ['aws-mcp-group'],
        organizationId: 'org-1',
        mockAgentOverrides: {
          Client: MockClient as any,
          StreamableHTTPClientTransport: MockTransport as any,
          getGatewaySessionToken: mockGetToken,
        },
      } as any,
    });

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      context,
    );

    expect(result.toolCount).toBe(2);
    expect(result.discoveredTools).toEqual([
      { name: 'aws-cloudtrail__lookup_events', description: 'Look up CloudTrail events' },
      { name: 'aws-s3__list_buckets', description: 'List S3 buckets' },
    ]);

    expect(mockGetToken).toHaveBeenCalledWith('test-run', 'org-1', ['aws-mcp-group']);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockListTools).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  test('passes authorization header to transport', async () => {
    const component = componentRegistry.get('mock.agent');
    expect(component).toBeDefined();

    let capturedTransportOptions: any;

    class MockClient {
      connect = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({ tools: [] });
      close = vi.fn().mockResolvedValue(undefined);
    }

    class MockTransport {
      constructor(
        public url: URL,
        public options: any,
      ) {
        capturedTransportOptions = options;
      }
    }

    const context = createTestContext({
      metadata: {
        runId: 'test-run',
        componentRef: 'mock.agent',
        connectedToolNodeIds: ['some-tool'],
        mockAgentOverrides: {
          Client: MockClient as any,
          StreamableHTTPClientTransport: MockTransport as any,
          getGatewaySessionToken: vi.fn().mockResolvedValue('my-token'),
        },
      } as any,
    });

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      { inputs: {}, params: {} },
      context,
    );

    expect(capturedTransportOptions.requestInit.headers).toMatchObject({
      Authorization: 'Bearer my-token',
    });
  });
});
