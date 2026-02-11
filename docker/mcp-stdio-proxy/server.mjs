import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

/**
 * Handle a JSON-RPC request by forwarding to the stdio MCP client.
 *
 * This bypasses the MCP SDK's Server class which only accepts one `initialize`
 * per lifetime. By handling JSON-RPC directly, we support unlimited HTTP clients
 * (e.g. worker for discovery, then gateway for tool calls) sharing one stdio server.
 */
async function handleJsonRpc(req, res, stdioClient, name) {
  const body = req.body;

  // Notifications have no `id` — return 202 Accepted (expected by MCP SDK client)
  if (body && body.method && body.id === undefined) {
    return res.status(202).end();
  }

  if (!body || !body.method) {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: body?.id ?? null,
      error: { code: -32600, message: 'Invalid request: missing method' },
    });
  }

  try {
    switch (body.method) {
      case 'initialize': {
        const result = {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: stdioClient.getServerCapabilities() ?? { tools: { listChanged: false } },
          serverInfo: stdioClient.getServerVersion() ?? {
            name: `mcp-proxy-${name}`,
            version: '1.0.0',
          },
          instructions: stdioClient.getInstructions?.(),
        };
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'tools/list': {
        const result = await stdioClient.listTools();
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'tools/call': {
        const result = await stdioClient.callTool({
          name: body.params.name,
          arguments: body.params.arguments ?? {},
        });
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'resources/list': {
        const result = await stdioClient.listResources();
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'resources/read': {
        const result = await stdioClient.readResource({ uri: body.params.uri });
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'prompts/list': {
        const result = await stdioClient.listPrompts();
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      case 'prompts/get': {
        const result = await stdioClient.getPrompt({
          name: body.params.name,
          arguments: body.params.arguments ?? {},
        });
        return res.json({ jsonrpc: '2.0', id: body.id, result });
      }

      default:
        return res.status(400).json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: `Method not found: ${body.method}` },
        });
    }
  } catch (error) {
    console.error(`[mcp-proxy] Error handling ${body.method} for '${name}':`, error.message);
    return res.status(200).json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32603, message: error.message },
    });
  }
}

const port = Number.parseInt(process.env.PORT || process.env.MCP_PORT || '8080', 10);

// Check if we have named servers configuration
const namedServersConfig = parseNamedServersConfig();
const hasNamedServers = namedServersConfig && namedServersConfig.mcpServers;

// Legacy mode: single server via MCP_COMMAND
const command = process.env.MCP_COMMAND;
const args = parseArgs(process.env.MCP_ARGS || '');

// Map to store connected stdio clients for named servers
// name -> { client }
const namedClients = new Map();

if (hasNamedServers) {
  console.log('[mcp-proxy] Starting in NAMED SERVERS mode');

  // Initialize all named servers (stdio connections only)
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

      namedClients.set(name, { client });
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

  namedClients.set('__default__', { client });
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

// Legacy endpoint for single-server mode — POST handles JSON-RPC, GET/DELETE return 405
app.post('/mcp', async (req, res) => {
  const namedClient = namedClients.get('__default__');
  if (!namedClient) {
    return res.status(503).json({ error: 'No MCP server connected' });
  }

  await handleJsonRpc(req, res, namedClient.client, 'default');
});

app.get('/mcp', (_req, res) => res.status(405).json({ error: 'SSE not supported, use POST' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Session cleanup not needed' }));

// Named server endpoints: /servers/:name/sse
app.post('/servers/:name/sse', async (req, res) => {
  const { name } = req.params;
  const namedClient = namedClients.get(name);

  if (!namedClient) {
    console.error(`[mcp-proxy] Unknown named server: ${name}`);
    return res.status(404).json({
      error: `Named server '${name}' not found`,
      availableServers: Array.from(namedClients.keys()),
    });
  }

  await handleJsonRpc(req, res, namedClient.client, name);
});

app.get('/servers/:name/sse', (_req, res) =>
  res.status(405).json({ error: 'SSE not supported, use POST' })
);
app.delete('/servers/:name/sse', (_req, res) =>
  res.status(405).json({ error: 'Session cleanup not needed' })
);

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
