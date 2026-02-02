const http = require('http');

const PORT = 8000;

const server = http.createServer((req, res) => {
  console.log(`[MCP Server] ${req.method} ${req.url}`);

  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    const data = body ? JSON.parse(body) : {};
    console.log(`[MCP Server] Request body:`, JSON.stringify(data, null, 2));

    res.writeHead(200, { 'Content-Type': 'application/json' });

    if (req.url === '/mcp' && req.method === 'POST') {
      const { method, params, id } = data;

      if (method === 'initialize') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: true }
            },
            serverInfo: {
              name: 'test-mcp-server',
              version: '1.0.0'
            }
          }
        }));
      } else if (method === 'tools/list') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'echo',
                description: 'Echoes back the input string',
                inputSchema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' }
                  },
                  required: ['message']
                }
              },
              {
                name: 'get_time',
                description: 'Returns the current server time',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              }
            ]
          }
        }));
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params;
        let result = {};

        if (name === 'echo') {
          result = { content: [{ type: 'text', text: `Echo: ${args.message}` }] };
        } else if (name === 'get_time') {
          result = { content: [{ type: 'text', text: `Current time: ${new Date().toISOString()}` }] };
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }));
          return;
        }

        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result
        }));
      } else if (method === 'notifications/initialized') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, result: {} }));
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
      }
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP Server running at http://0.0.0.0:${PORT}/mcp`);
});
