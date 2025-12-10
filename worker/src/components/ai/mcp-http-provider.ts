import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
} from '@shipsec/component-sdk';
import {
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
  mcpToolContractName,
} from './mcp-tool-contract';

const toolEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  toolName: z.string().optional(),
  arguments: z.array(McpToolArgumentSchema).optional(),
});

const inputSchema = z.object({
  endpoint: z
    .string()
    .min(1, 'MCP endpoint is required')
    .describe('HTTP endpoint that implements the MCP tool invocation contract.'),
  headersJson: z
    .string()
    .optional()
    .describe('Optional JSON object of HTTP headers (e.g., auth tokens).'),
  tools: z
    .array(toolEntrySchema)
    .default([])
    .describe('List of tool entries exposed by this MCP endpoint.'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  tools: z.array(McpToolDefinitionSchema),
});

type Output = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.mcp.tools.http',
  label: 'MCP HTTP Tools',
  category: 'ai',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Expose a list of MCP tools backed by an HTTP endpoint (custom or third-party).',
  metadata: {
    slug: 'mcp-tools-http',
    version: '0.1.0',
    type: 'process',
    category: 'ai',
    description: 'Package multiple tools served by an HTTP MCP endpoint for consumption by the AI agent.',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'endpoint',
        label: 'MCP Endpoint',
        dataType: port.text(),
        required: true,
        description: 'HTTP URL for the MCP tool server (POST requests are sent here).',
      },
      {
        id: 'headersJson',
        label: 'Headers (JSON)',
        dataType: port.text(),
        required: false,
        description: 'Optional headers JSON (e.g., {"Authorization":"Bearer ..."}).',
      },
      {
        id: 'tools',
        label: 'Tools',
        dataType: port.json(),
        required: false,
        description: 'Structured tool list (id,title,description,toolName).',
      },
    ],
    outputs: [
      {
        id: 'tools',
        label: 'MCP Tools',
        dataType: port.list(port.contract(mcpToolContractName)),
        description: 'List of MCP tool definitions emitted by this provider.',
      },
    ],
    parameters: [
      {
        id: 'endpoint',
        label: 'Endpoint',
        type: 'text',
        required: true,
        description: 'HTTP endpoint that accepts MCP tool invocations.',
      },
      {
        id: 'headersJson',
        label: 'Headers (JSON)',
        type: 'textarea',
        required: false,
        description: 'Optional JSON object of headers (one per line).',
      },
      {
        id: 'tools',
        label: 'Tools',
        type: 'json',
        required: false,
        default: [],
        description:
          'Array of tool entries, e.g., [{"id":"lookup_fact","title":"Lookup Fact","arguments":[{"name":"topic","type":"string"}]}].',
      },
    ],
  },
  async execute(params, context) {
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
};

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
