import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  InitializedNotificationSchema,
  ListToolsRequestSchema,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';

function parseArgs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return raw
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const command = process.env.MCP_COMMAND;
const args = parseArgs(process.env.MCP_ARGS || '');
const port = Number.parseInt(process.env.PORT || process.env.MCP_PORT || '8080', 10);

if (!command) {
  console.error('MCP_COMMAND is required to start the stdio MCP server.');
  process.exit(1);
}

const client = new Client({ name: 'shipsec-mcp-stdio-proxy', version: '1.0.0' });
const clientTransport = new StdioClientTransport({
  command,
  args,
});

await client.connect(clientTransport);

const server = new Server(
  {
    name: 'shipsec-mcp-stdio-proxy',
    version: '1.0.0',
  },
  {
    capabilities: client.getServerCapabilities() ?? {
      tools: { listChanged: false },
    },
  },
);

server.setRequestHandler(InitializeRequestSchema, async () => {
  return {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: client.getServerCapabilities() ?? {},
    serverInfo: client.getServerVersion() ?? {
      name: 'shipsec-mcp-stdio-proxy',
      version: '1.0.0',
    },
    instructions: client.getInstructions?.(),
  };
});

server.setNotificationHandler(InitializedNotificationSchema, () => {
  // no-op
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return await client.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await client.callTool({
    name: request.params.name,
    arguments: request.params.arguments ?? {},
  });
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

await server.connect(transport);

const app = express();
app.use(express.json({ limit: '2mb' }));

app.all('/mcp', async (req, res) => {
  console.log('[mcp-proxy] incoming request', {
    method: req.method,
    path: req.path,
    headers: {
      'mcp-session-id': req.headers['mcp-session-id'],
      accept: req.headers['accept'],
      'content-type': req.headers['content-type'],
    },
    body: req.body,
  });
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp-proxy] Failed to handle MCP request', error);
    if (!res.headersSent) {
      res.status(500).send('MCP proxy error');
    }
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', toolCount: tools.length });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`MCP stdio proxy listening on http://0.0.0.0:${port}/mcp`);
  console.log(`Proxied MCP command: ${command} ${args.join(' ')}`);
});
