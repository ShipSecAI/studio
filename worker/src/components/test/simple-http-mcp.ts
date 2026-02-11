/**
 * Simple HTTP MCP Server Tool Component
 * Returns an HTTP endpoint with a single get_weather tool
 */

import {
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  runComponentWithRunner,
} from '@shipsec/component-sdk';
import { z } from 'zod';
import { createIsolatedVolume } from '../../utils/isolated-volume';

const inputSchema = inputs({});

const parameterSchema = parameters({
  port: param(z.number().default(8000).describe('Port for MCP server'), {
    label: 'Port',
    editor: 'number',
    description: 'Port to run MCP server on',
  }),
});

const outputSchema = outputs({
  endpoint: port(z.string(), {
    label: 'Endpoint',
    description: 'HTTP endpoint of the MCP server',
  }),
  containerId: port(z.string(), {
    label: 'Container ID',
    description: 'Docker container ID running the server',
  }),
  status: port(z.string(), {
    label: 'Status',
    description: 'Server status',
  }),
});

const definition = defineComponent({
  id: 'test.mcp.simple-http',
  label: 'Simple HTTP MCP Server',
  category: 'mcp',
  runner: {
    kind: 'docker',
    image: 'node:20-alpine',
    network: 'host',
    entrypoint: '/bin/sh',
    command: ['-c', 'node /workspace/server.js'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Simple HTTP MCP server for testing tool discovery',
  ui: {
    slug: 'simple-http-mcp',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description: 'Simple HTTP MCP server with get_weather tool',
    icon: 'Cloud',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs: _inputs, params }, context) {
    const { port } = params;
    const { tenantId = 'default' } = context as any;
    const volume = createIsolatedVolume(tenantId, context.runId);

    try {
      // Create MCP server script
      const mcpScript = `
const http = require('http');
const url = require('url');

// Define tools
const tools = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a location',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or location',
        },
      },
      required: ['location'],
    },
  },
];

// Create HTTP server
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  // Parse request
  const pathname = url.parse(req.url).pathname;
  
  if (pathname === '/mcp/tools') {
    // Tool discovery endpoint
    console.error('[MCP-SERVER] Tools discovery request');
    res.writeHead(200);
    res.end(JSON.stringify({ tools }, null, 2));
  } else if (pathname === '/mcp/invoke') {
    // Tool invocation endpoint
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { tool, input } = JSON.parse(body);
        console.error(\`[MCP-SERVER] Tool call: \${tool}\`);
        
        if (tool === 'get_weather') {
          const location = input.location || 'Unknown';
          const result = {
            location: location,
            temperature: 22,
            condition: 'Sunny',
            humidity: 65,
            wind_speed: 10,
            units: 'celsius',
            timestamp: new Date().toISOString(),
            mcp_server_called: true,
            message: \`Weather data from MCP server for \${location}\`,
          };
          res.writeHead(200);
          res.end(JSON.stringify(result, null, 2));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Unknown tool' }, null, 2));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Server error' }, null, 2));
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }, null, 2));
  }
});

server.listen(${port}, '0.0.0.0', () => {
  console.error('[MCP-SERVER] HTTP MCP server running on port ${port}');
});

// Keep server alive
process.on('SIGTERM', () => {
  console.error('[MCP-SERVER] Received SIGTERM, shutting down');
  server.close(() => process.exit(0));
});
`;

      // Initialize volume with the MCP server script
      await volume.initialize({
        'server.js': mcpScript,
      });

      context.emitProgress({
        message: 'Starting HTTP MCP server...',
        level: 'info',
      });

      // Run the MCP server
      const runnerConfig = {
        kind: 'docker' as const,
        image: 'node:20-alpine',
        network: 'host' as const,
        entrypoint: 'node',
        command: ['/workspace/server.js'],
        volumes: [volume.getVolumeConfig('/workspace', false)],
        workingDir: '/workspace',
      };

      // Run with a long timeout since this is a server
      const result = await runComponentWithRunner(
        runnerConfig,
        async (_raw) => {
          // The server will keep running, we just need to return the endpoint
          return {
            endpoint: `http://127.0.0.1:${port}/mcp`,
            containerId: 'simple-http-mcp-container',
            status: 'running',
          };
        },
        { timeout: 30000 }, // 30 second startup timeout
        context,
      );

      context.emitProgress({
        message: 'MCP server started successfully',
        level: 'info',
      });

      return result;
    } finally {
      // Don't cleanup - server needs to keep running
    }
  },
});

export default definition;
