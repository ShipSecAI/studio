import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
} from '@shipsec/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DEFAULT_GATEWAY_URL, getGatewaySessionToken } from '../ai/utils';

const inputSchema = inputs({
  tools: port(z.unknown().optional().describe('Anchor for tool-mode nodes.'), {
    label: 'Connected Tools',
    description: 'Connect tool-mode nodes here to expose them to the mock agent.',
    allowAny: true,
    reason: 'Tool-mode port acts as a graph anchor; payloads are not consumed directly.',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
  }),
});

const outputSchema = outputs({
  discoveredTools: port(
    z.array(z.object({ name: z.string(), description: z.string().optional() })),
    {
      label: 'Discovered Tools',
      description: 'List of tool names and descriptions discovered via the MCP gateway.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  toolCount: port(z.number(), {
    label: 'Tool Count',
    description: 'Number of tools discovered.',
  }),
});

export interface MockAgentOverrides {
  Client?: typeof Client;
  StreamableHTTPClientTransport?: typeof StreamableHTTPClientTransport;
  getGatewaySessionToken?: typeof getGatewaySessionToken;
}

const definition = defineComponent({
  id: 'mock.agent',
  label: 'Mock Agent (Debug)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameters({}),
  docs: 'Developer-only component that connects to the MCP gateway, lists all available tools, and returns them. Useful for verifying the full tool discovery pipeline without running a real AI agent.',
  ui: {
    slug: 'mock-agent',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Debug component: lists MCP tools visible to this agent.',
    icon: 'Bug',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute(_data, context) {
    const { connectedToolNodeIds, organizationId } = context.metadata;
    const overrides = (context.metadata as { mockAgentOverrides?: MockAgentOverrides })
      .mockAgentOverrides;

    const ClientImpl = overrides?.Client ?? Client;
    const TransportImpl = overrides?.StreamableHTTPClientTransport ?? StreamableHTTPClientTransport;
    const getTokenImpl = overrides?.getGatewaySessionToken ?? getGatewaySessionToken;

    const connectedIds = connectedToolNodeIds ?? [];
    console.log(`[mock.agent] connectedToolNodeIds: ${connectedIds.join(', ') || '(none)'}`);

    if (connectedIds.length === 0) {
      console.log('[mock.agent] No connected tool nodes, returning empty list');
      return outputSchema.parse({ discoveredTools: [], toolCount: 0 });
    }

    // 1. Get gateway session token
    const sessionToken = await getTokenImpl(
      context.runId,
      organizationId ?? null,
      connectedIds,
    );

    // 2. Connect to gateway via MCP SDK client
    const gatewayUrl = DEFAULT_GATEWAY_URL;
    console.log(`[mock.agent] Connecting to gateway: ${gatewayUrl}`);

    const transport = new TransportImpl(new URL(gatewayUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: 'application/json, text/event-stream',
        },
      },
    });

    const client = new ClientImpl(
      { name: 'shipsec-mock-agent', version: '1.0.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      const res = await client.listTools();
      const tools = (res.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      }));

      console.log(`[mock.agent] Discovered ${tools.length} tools:`);
      for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description ?? '(no description)'}`);
      }

      return outputSchema.parse({ discoveredTools: tools, toolCount: tools.length });
    } finally {
      await client.close().catch(() => {});
    }
  },
});

componentRegistry.register(definition);
