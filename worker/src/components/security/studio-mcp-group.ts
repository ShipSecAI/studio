import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
} from '@shipsec/component-sdk';

function getReachableBackendOrigin(override?: string | null): string {
  const hotplugOrigin = process.env.HOTPLUG_BACKEND_ORIGIN?.trim();
  if (hotplugOrigin) return hotplugOrigin.replace(/\/+$/, '');

  const origin = override?.trim() || process.env.BACKEND_ORIGIN || 'http://localhost:3000';
  return origin
    .replace('://localhost', '://host.docker.internal')
    .replace('://127.0.0.1', '://host.docker.internal')
    .replace(/\/+$/, '');
}

const inputSchema = inputs({
  apiKey: port(z.string().min(1).describe('ShipSec Studio API key with analytics.query access.'), {
    label: 'Studio API Key',
    description: 'API key used by the agent to call the official ShipSec Studio MCP endpoint.',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
});

const outputSchema = outputs({
  tools: port(z.unknown().optional().describe('Official ShipSec Studio MCP tools'), {
    label: 'Studio Tools',
    description: 'Official ShipSec Studio MCP tools exposed to connected agents.',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
    allowAny: true,
    reason: 'Studio MCP tools are discovered dynamically from the backend.',
  }),
  remoteMcpAttachments: port(
    z
      .array(
        z.object({
          alias: z.string(),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional()
      .describe('Hotplug remote MCP attachment for the official Studio MCP server'),
    {
      label: 'Remote MCP Attachments',
      description: 'Attachment spec consumed by workflow orchestration.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const parameterSchema = parameters({
  backendOrigin: param(
    z.string().optional().default('').describe('Optional backend origin override.'),
    {
      label: 'Backend Origin',
      editor: 'text',
      description: 'Defaults to BACKEND_ORIGIN or http://localhost:3000.',
    },
  ),
});

const definition = defineComponent({
  id: 'mcp.group.studio',
  label: 'ShipSec Studio MCP',
  category: 'mcp',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Expose the official ShipSec Studio MCP tools to an agent running inside a workflow. Use this when the agent needs to read durable findings, record finding links, or record threat stories.',
  toolProvider: {
    kind: 'mcp-group',
    name: 'studio',
    description: 'Official ShipSec Studio MCP tools',
  },
  ui: {
    slug: 'studio-mcp-group',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description: 'Expose official ShipSec Studio MCP tools to workflow agents.',
    icon: 'ShipWheel',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute({ inputs, params }) {
    const backendOrigin = getReachableBackendOrigin(params.backendOrigin);
    const url = `${backendOrigin}/api/v1/studio-mcp`;
    return {
      tools: [{ id: 'studio-mcp', name: 'ShipSec Studio MCP', type: 'remote-mcp-server', url }],
      remoteMcpAttachments: [
        {
          alias: 'shipsec-studio',
          url,
          headers: {
            Authorization: `Bearer ${inputs.apiKey}`,
          },
        },
      ],
    };
  },
});

componentRegistry.register(definition);

export type StudioMcpGroupInput = typeof inputSchema;
export type StudioMcpGroupParams = typeof parameterSchema;
export type StudioMcpGroupOutput = typeof outputSchema;
