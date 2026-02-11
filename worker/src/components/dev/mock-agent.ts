import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DEFAULT_GATEWAY_URL, getGatewaySessionToken } from '../ai/utils';

/**
 * Test calls to exercise discovered tools.
 * Maps tool name patterns to test arguments.
 */
const TEST_TOOL_CALLS: Record<string, Record<string, unknown>> = {
  abuseipdb_check: { ipAddress: '8.8.8.8' },
  virustotal_lookup: { indicator: '8.8.8.8' },
};

/**
 * For AWS MCP tools, use safe read-only calls with minimal arguments.
 */
const AWS_TOOL_TEST_ARGS: Record<string, Record<string, unknown>> = {
  lookup_events: { max_results: 1 },
  list_users: {},
  get_active_alarms: {},
};

const inputSchema = inputs({
  tools: port(z.unknown().optional().describe('Anchor for tool-mode nodes.'), {
    label: 'Connected Tools',
    description: 'Connect tool-mode nodes here to expose them to the mock agent.',
    allowAny: true,
    reason: 'Tool-mode port acts as a graph anchor; payloads are not consumed directly.',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
  }),
});

const ToolCallResultSchema = z.object({
  toolName: z.string(),
  success: z.boolean(),
  durationMs: z.number(),
  output: z.unknown().optional(),
  error: z.string().optional(),
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
  toolCallResults: port(z.array(ToolCallResultSchema), {
    label: 'Tool Call Results',
    description: 'Results from calling each discovered tool with test arguments.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  callTools: param(z.boolean().default(true), {
    label: 'Call Tools',
    editor: 'boolean',
    description: 'If true, actually call each discovered tool with test arguments.',
  }),
  maxToolCalls: param(z.number().min(0).default(10), {
    label: 'Max Tool Calls',
    editor: 'number',
    description: 'Maximum number of tool calls to make (0 = discovery only).',
  }),
});

export interface MockAgentOverrides {
  Client?: typeof Client;
  StreamableHTTPClientTransport?: typeof StreamableHTTPClientTransport;
  getGatewaySessionToken?: typeof getGatewaySessionToken;
}

/**
 * Determine test arguments for a tool based on its name.
 * Returns null if no test args are known for this tool.
 */
function getTestArgsForTool(toolName: string): Record<string, unknown> | null {
  // Direct match on known component tool names
  if (TEST_TOOL_CALLS[toolName]) {
    return TEST_TOOL_CALLS[toolName];
  }

  // AWS MCP tools use prefixed names like "aws-cloudtrail__lookup_events"
  // Extract the actual tool name after the __ separator
  const parts = toolName.split('__');
  if (parts.length === 2) {
    const actualToolName = parts[1];
    if (AWS_TOOL_TEST_ARGS[actualToolName]) {
      return AWS_TOOL_TEST_ARGS[actualToolName];
    }
  }

  return null;
}

const definition = defineComponent({
  id: 'mock.agent',
  label: 'Mock Agent (Debug)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Developer-only component that connects to the MCP gateway, discovers tools, and optionally calls each tool with test arguments. Useful for verifying the full tool call pipeline without a real AI agent.',
  ui: {
    slug: 'mock-agent',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Debug component: discovers and calls MCP tools.',
    icon: 'Bug',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ params }, context) {
    const { connectedToolNodeIds, organizationId } = context.metadata;
    const overrides = (context.metadata as { mockAgentOverrides?: MockAgentOverrides })
      .mockAgentOverrides;

    const ClientImpl = overrides?.Client ?? Client;
    const TransportImpl = overrides?.StreamableHTTPClientTransport ?? StreamableHTTPClientTransport;
    const getTokenImpl = overrides?.getGatewaySessionToken ?? getGatewaySessionToken;

    const callTools = params.callTools ?? true;
    const maxToolCalls = params.maxToolCalls ?? 10;

    const connectedIds = connectedToolNodeIds ?? [];
    console.log(`[mock.agent] connectedToolNodeIds: ${connectedIds.join(', ') || '(none)'}`);
    console.log(`[mock.agent] callTools=${callTools}, maxToolCalls=${maxToolCalls}`);

    if (connectedIds.length === 0) {
      console.log('[mock.agent] No connected tool nodes, returning empty list');
      return outputSchema.parse({ discoveredTools: [], toolCount: 0, toolCallResults: [] });
    }

    // 1. Get gateway session token
    const sessionToken = await getTokenImpl(context.runId, organizationId ?? null, connectedIds);

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

      // Phase 1: Discover tools
      const res = await client.listTools();
      const tools = (res.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      }));

      console.log(`[mock.agent] Discovered ${tools.length} tools:`);
      for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description ?? '(no description)'}`);
      }

      // Phase 2: Call tools with test arguments
      const toolCallResults: z.infer<typeof ToolCallResultSchema>[] = [];

      if (callTools && maxToolCalls > 0) {
        let callCount = 0;

        for (const tool of tools) {
          if (callCount >= maxToolCalls) {
            console.log(`[mock.agent] Reached max tool calls (${maxToolCalls}), stopping.`);
            break;
          }

          const testArgs = getTestArgsForTool(tool.name);
          if (!testArgs) {
            console.log(`[mock.agent] No test args for tool '${tool.name}', skipping call.`);
            continue;
          }

          console.log(
            `[mock.agent] ▶ Calling tool '${tool.name}' with args: ${JSON.stringify(testArgs)}`,
          );
          const startTime = Date.now();

          try {
            const result = await client.callTool({
              name: tool.name,
              arguments: testArgs,
            });

            const durationMs = Date.now() - startTime;
            const isError = result.isError === true;
            const content = result.content;

            // Extract text content for logging
            let outputText = '';
            if (Array.isArray(content)) {
              for (const item of content) {
                if (typeof item === 'object' && item !== null && 'text' in item) {
                  outputText += (item as { text: string }).text;
                }
              }
            }

            if (isError) {
              console.log(
                `[mock.agent] ✗ Tool '${tool.name}' returned error (${durationMs}ms): ${outputText.substring(0, 200)}`,
              );
              toolCallResults.push({
                toolName: tool.name,
                success: false,
                durationMs,
                error: outputText.substring(0, 500),
              });
            } else {
              console.log(
                `[mock.agent] ✓ Tool '${tool.name}' succeeded (${durationMs}ms), output length: ${outputText.length} chars`,
              );
              console.log(
                `[mock.agent]   Preview: ${outputText.substring(0, 200)}${outputText.length > 200 ? '...' : ''}`,
              );
              toolCallResults.push({
                toolName: tool.name,
                success: true,
                durationMs,
                output:
                  outputText.length > 2000
                    ? outputText.substring(0, 2000) + '...(truncated)'
                    : outputText,
              });
            }
          } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(
              `[mock.agent] ✗ Tool '${tool.name}' threw exception (${durationMs}ms): ${errorMsg}`,
            );
            toolCallResults.push({
              toolName: tool.name,
              success: false,
              durationMs,
              error: errorMsg.substring(0, 500),
            });
          }

          callCount++;
        }

        const succeeded = toolCallResults.filter((r) => r.success).length;
        const failed = toolCallResults.filter((r) => !r.success).length;
        console.log(
          `[mock.agent] Tool call summary: ${succeeded} succeeded, ${failed} failed out of ${toolCallResults.length} calls`,
        );
      }

      return outputSchema.parse({
        discoveredTools: tools,
        toolCount: tools.length,
        toolCallResults,
      });
    } finally {
      await client.close().catch(() => {});
    }
  },
});

componentRegistry.register(definition);
