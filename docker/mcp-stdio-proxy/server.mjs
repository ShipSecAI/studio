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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Parse named servers config from JSON file or MCP_NAMED_SERVERS env var
function parseNamedServersConfig() {
  // Try env var first (JSON string)
  if (process.env.MCP_NAMED_SERVERS) {
    try {
      return JSON.parse(process.env.MCP_NAMED_SERVERS);
    } catch (err) {
      console.error('[mcp-proxy] Failed to parse MCP_NAMED_SERVERS JSON:', err.message);
    }
  }

  // Try config file path
  if (process.env.MCP_NAMED_SERVERS_CONFIG) {
    try {
      const configPath = process.env.MCP_NAMED_SERVERS_CONFIG;
      const configContent = readFileSync(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (err) {
      console.error('[mcp-proxy] Failed to read MCP_NAMED_SERVERS_CONFIG file:', err.message);
    }
  }

  // Try default config file location
  const defaultConfigPath = join(__dirname, 'named-servers.json');
  try {
    const configContent = readFileSync(defaultConfigPath, 'utf-8');
    return JSON.parse(configContent);
  } catch (err) {
    // Config file doesn't exist, not an error
  }

  return null;
}

const port = Number.parseInt(process.env.PORT || process.env.MCP_PORT || '8080', 10);

// Check if we have named servers configuration
const namedServersConfig = parseNamedServersConfig();
const hasNamedServers = namedServersConfig && namedServersConfig.mcpServers;

// Legacy mode: single server via MCP_COMMAND
const command = process.env.MCP_COMMAND;
const args = parseArgs(process.env.MCP_ARGS || '');

// Map to store connected clients for named servers
// name -> { client, server, transport }
const namedClients = new Map();

if (hasNamedServers) {
  console.log('[mcp-proxy] Starting in NAMED SERVERS mode');

  // Initialize all named servers
  for (const [name, serverConfig] of Object.entries(namedServersConfig.mcpServers)) {
    try {
      console.log(`[mcp-proxy] Initializing named server: ${name}`);
      console.log(`[mcp-proxy]   command: ${serverConfig.command}`);
      console.log(`[mcp-proxy]   args: ${serverConfig.args?.join(' ') || '(none)'}`);

      const client = new Client({
        name: `mcp-proxy-${name}`,
        version: '1.0.0'
      });

      const clientTransport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: serverConfig.env || {},
      });

      await client.connect(clientTransport);

      const server = new Server(
        {
          name: `mcp-proxy-${name}`,
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
            name: `mcp-proxy-${name}`,
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
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });

      await server.connect(transport);

      namedClients.set(name, { client, server, transport });
      console.log(`[mcp-proxy] Named server '${name}' ready`);
    } catch (err) {
      console.error(`[mcp-proxy] Failed to initialize named server '${name}':`, err.message);
    }
  }

  console.log(`[mcp-proxy] Initialized ${namedClients.size} named server(s)`);
} else {
  // Legacy single-server mode
  console.log('[mcp-proxy] Starting in SINGLE SERVER mode (legacy)');

  if (!command) {
    console.error('MCP_COMMAND is required to start the stdio MCP server in single-server mode.');
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
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  await server.connect(transport);

  namedClients.set('__default__', { client, server, transport });
  console.log(`[mcp-proxy] Single server mode ready: ${command} ${args.join(' ')}`);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  const serverNames = hasNamedServers
    ? Object.keys(namedServersConfig.mcpServers)
    : ['__default__'];

  res.json({
    status: 'ok',
    mode: hasNamedServers ? 'named-servers' : 'single-server',
    servers: serverNames.map(name => ({
      name: name === '__default__' ? 'default' : name,
      ready: namedClients.has(name),
    })),
  });
});

// List available named servers
app.get('/servers', (_req, res) => {
  if (!hasNamedServers) {
    return res.json({ servers: [{ name: 'default', path: '/mcp' }] });
  }

  res.json({
    servers: Object.keys(namedServersConfig.mcpServers).map(name => ({
      name,
      path: `/servers/${name}/sse`,
    })),
  });
});

// Legacy endpoint for single-server mode
app.all('/mcp', async (req, res) => {
  const namedClient = namedClients.get('__default__');
  if (!namedClient) {
    return res.status(503).json({ error: 'No MCP server connected' });
  }

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
    await namedClient.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp-proxy] Failed to handle MCP request', error);
    if (!res.headersSent) {
      res.status(500).send('MCP proxy error');
    }
  }
});

// Named server endpoints: /servers/:name/sse
app.all('/servers/:name/sse', async (req, res) => {
  const { name } = req.params;
  const namedClient = namedClients.get(name);

  if (!namedClient) {
    console.error(`[mcp-proxy] Unknown named server: ${name}`);
    return res.status(404).json({
      error: `Named server '${name}' not found`,
      availableServers: Array.from(namedClients.keys()),
    });
  }

  console.log(`[mcp-proxy] incoming request for server '${name}'`, {
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
    await namedClient.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[mcp-proxy] Failed to handle MCP request for server '${name}':`, error);
    if (!res.headersSent) {
      res.status(500).send(`MCP proxy error for server '${name}'`);
    }
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`[mcp-proxy] Listening on http://0.0.0.0:${port}`);
  if (hasNamedServers) {
    console.log(`[mcp-proxy] Named servers mode:`);
    for (const name of Object.keys(namedServersConfig.mcpServers)) {
      console.log(`[mcp-proxy]   - /servers/${name}/sse`);
    }
  } else {
    console.log(`[mcp-proxy] Single server mode: /mcp`);
  }
});
