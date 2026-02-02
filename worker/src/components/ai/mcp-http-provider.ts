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
import { McpToolArgumentSchema, McpToolDefinitionSchema } from '@shipsec/contracts';

const toolEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  toolName: z.string().optional(),
  arguments: z.array(McpToolArgumentSchema).optional(),
});

const inputSchema = inputs({});

const parameterSchema = parameters({
  endpoint: param(
    z
      .string()
      .min(1, 'MCP endpoint is required')
      .describe('HTTP endpoint that implements the MCP tool invocation contract.'),
    {
      label: 'Endpoint',
      editor: 'text',
      description: 'HTTP endpoint that accepts MCP tool invocations.',
    },
  ),
  headersJson: param(
    z.string().optional().describe('Optional JSON object of HTTP headers (e.g., auth tokens).'),
    {
      label: 'Headers (JSON)',
      editor: 'textarea',
      description: 'Optional JSON object of headers (one per line).',
    },
  ),
  tools: param(
    z
      .array(toolEntrySchema)
      .default([])
      .describe('List of tool entries exposed by this MCP endpoint.'),
    {
      label: 'Tools',
      editor: 'json',
      description:
        'Array of tool entries, e.g., [{"id":"lookup_fact","title":"Lookup Fact","arguments":[{"name":"topic","type":"string"}]}].',
    },
  ),
});

const outputSchema = outputs({
  tools: port(z.array(McpToolDefinitionSchema()), {
    label: 'MCP Tools',
    description: 'List of MCP tool definitions emitted by this provider.',
  }),
});

const definition = defineComponent({
  id: 'core.mcp.tools.http',
  label: 'MCP HTTP Tools',
  category: 'ai',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Expose a list of MCP tools backed by an HTTP endpoint (custom or third-party).',
  ui: {
    slug: 'mcp-tools-http',
    version: '0.1.0',
    type: 'process',
    category: 'ai',
    description:
      'Package multiple tools served by an HTTP MCP endpoint for consumption by the AI agent.',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ params }, context) {
    const headers = parseHeaders(params.headersJson);
    const tools = (params.tools ?? []).map((tool) => ({
      id: tool.id,
      title: tool.title,
      description: tool.description,
      endpoint: params.endpoint,
      headers,
      arguments: tool.arguments,
      metadata: {
        toolName: tool.toolName ?? tool.id,
        source: context.componentRef,
      },
    }));

    context.logger.info(
      `[McpHttpTools] Prepared ${tools.length} MCP tool${tools.length === 1 ? '' : 's'} from ${params.endpoint}.`,
    );

    return { tools };
  },
});

function parseHeaders(headersJson?: string | null): Record<string, string> | undefined {
  if (!headersJson || headersJson.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(headersJson);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        }
        return acc;
      }, {});
    }
  } catch (error) {
    console.warn('[McpHttpTools] Failed to parse headers JSON:', error);
  }
  return undefined;
}

componentRegistry.register(definition);
