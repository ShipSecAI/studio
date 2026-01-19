import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({});

const outputSchema = outputs({
  endpoint: z.string().describe('The URL of the MCP server'),
});

const parameterSchema = parameters({
  image: param(z.string().describe('Docker image for the MCP server'), {
    label: 'Docker Image',
    editor: 'text',
    placeholder: 'mcp/myserver:latest',
  }),
  command: param(z.array(z.string()).default([]).describe('Entrypoint command'), {
    label: 'Command',
    editor: 'variable-list',
  }),
  args: param(z.array(z.string()).default([]).describe('Arguments for the command'), {
    label: 'Arguments',
    editor: 'variable-list',
  }),
  env: param(z.record(z.string(), z.string()).default({}).describe('Environment variables'), {
    label: 'Environment Variables',
    editor: 'json',
  }),
  port: param(z.number().default(8080).describe('Internal port the server listens on'), {
    label: 'Port',
    editor: 'number',
  }),
});

const definition = defineComponent({
  id: 'core.mcp.server',
  label: 'MCP Server',
  category: 'it_ops',
  runner: {
    kind: 'docker',
    image: '{{params.image}}',
    command: ['{{params.command}}', '{{params.args}}'],
    // MCP servers usually run long-lived, but here they'll run as a background task 
    // within the workflow execution logic if needed.
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Starts an external MCP server in a Docker container and registers it as a tool source.',
  ui: {
    slug: 'mcp-server',
    version: '1.0.0',
    type: 'process',
    category: 'it_ops',
    description: 'Run an external Model Context Protocol (MCP) server.',
    icon: 'Server',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute() {
    // The Docker runner handles execution. 
    // At runtime, the workflow engine will resolve the dynamic endpoint.
    return {
      endpoint: 'http://localhost:8080', // Placeholder
    };
  },
});

componentRegistry.register(definition);

export type McpServerInput = typeof inputSchema;
export type McpServerParams = typeof parameterSchema;
export type McpServerOutput = typeof outputSchema;
