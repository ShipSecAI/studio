import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  outputs,
  inputs,
  parameters,
  param,
  port,
} from '@shipsec/component-sdk';
import { fetchEnabledServers, registerServerTools } from './mcp-library-utils';

const inputSchema = inputs({});

const parameterSchema = parameters({
  enabledServers: param(
    z.array(z.string()).default([]).describe('Array of MCP server IDs to enable'),
    {
      label: 'Enabled Servers',
      editor: 'multi-select',
      description: 'Select MCP servers to enable tools from',
    },
  ),
});

const outputSchema = outputs({
  tools: port(z.unknown().optional().describe('MCP tools from selected servers'), {
    label: 'Tools',
    description: 'MCP tools from selected servers',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
    allowAny: true,
    reason:
      'MCP tools are dynamically discovered from the server at runtime and cannot have a fixed schema',
  }),
});

const definition = defineComponent({
  id: 'core.mcp.library',
  label: 'Custom MCPs',
  category: 'mcp',
  runner: {
    kind: 'inline',
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Select and enable custom MCP servers. All tools from selected servers will be available to connected AI agents.',
  ui: {
    slug: 'mcp-library',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description: 'Select multiple custom MCP servers to expose their tools to AI agents.',
    icon: 'Library',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    agentTool: {
      enabled: true,
      toolName: 'mcp_library',
      toolDescription: 'Expose custom MCP tools from configured servers.',
    },
    isLatest: true,
  },
  async execute({ params }, context) {
    const enabledServers = params.enabledServers as string[];

    // 1. Fetch server details from backend
    const servers = await fetchEnabledServers(enabledServers, context);

    // 2. Register each server's tools with Tool Registry
    for (const server of servers) {
      await registerServerTools(server, context);
    }

    // 3. Return empty (tools are registered, not returned as data)
    return {};
  },
});

componentRegistry.register(definition);

export type McpLibraryInput = typeof inputSchema;
export type McpLibraryParams = typeof parameterSchema;
export type McpLibraryOutput = typeof outputSchema;
