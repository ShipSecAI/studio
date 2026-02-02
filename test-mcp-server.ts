#!/usr/bin/env node
/**
 * Simple MCP Server for Testing
 * Exposes a single "get_weather" tool
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// Create server
const server = new Server(
  {
    name: 'test-weather-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Define tools
const tools: Tool[] = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a location',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or zip code',
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units (default: celsius)',
        },
      },
      required: ['location'],
    },
  },
];

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error('[TEST-MCP] Received list_tools request');
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`[TEST-MCP] Received tool call: ${request.params.name}`);

  if (request.params.name === 'get_weather') {
    const { location, units = 'celsius' } = request.params.arguments as {
      location: string;
      units?: string;
    };

    const weather = {
      location: location,
      temperature: 22,
      condition: 'Sunny',
      humidity: 65,
      wind_speed: 10,
      units: units,
      timestamp: new Date().toISOString(),
      mcp_server_response: true,
      message: `This is a real response from the MCP server for ${location}!`,
    };

    console.error(`[TEST-MCP] Returning weather for: ${location}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(weather, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${request.params.name}`,
      },
    ],
    isError: true,
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[TEST-MCP] Server started on stdio');
}

main().catch(console.error);
