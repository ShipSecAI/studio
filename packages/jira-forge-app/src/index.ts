import { webTrigger } from '@forge/api';
import { handleMcpRequest } from './mcp-handler';
import type { JsonRpcRequest, WebTriggerRequest, WebTriggerResponse } from './types';

const SHARED_SECRET = process.env.SHIPSEC_MCP_SECRET || '';

// ---------------------------------------------------------------------------
// Install lifecycle handler
// ---------------------------------------------------------------------------

interface InstallEvent {
  id: string;
  installerAccountId?: string;
  app: { id: string; version: string };
  environment?: { id: string };
}

export async function onInstall(event: InstallEvent): Promise<void> {
  console.log('[ShipSec Forge] App installed.', {
    installationId: event.id,
    appId: event.app.id,
  });

  try {
    const mcpUrl = await webTrigger.getUrl('mcp-endpoint');
    console.log('[ShipSec Forge] Web trigger URL resolved. Add this URL to Studio manually:', mcpUrl);
  } catch (err) {
    console.error('[ShipSec Forge] Failed to resolve web trigger URL (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// MCP web trigger handler
// ---------------------------------------------------------------------------

function verifyAuth(request: WebTriggerRequest): boolean {
  if (!SHARED_SECRET) return true; // No secret configured — allow (dev mode)
  const authHeader = request.headers['x-shipsec-secret']?.[0];
  return authHeader === SHARED_SECRET;
}

export async function handler(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const corsHeaders: Record<string, string[]> = {
    'Access-Control-Allow-Origin': ['*'],
    'Access-Control-Allow-Methods': ['POST', 'OPTIONS'],
    'Access-Control-Allow-Headers': ['Content-Type', 'x-shipsec-secret', 'Mcp-Session-Id'],
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Only accept POST
  if (request.method !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': ['application/json'] },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
    };
  }

  // Verify shared secret
  if (!verifyAuth(request)) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders, 'Content-Type': ['application/json'] },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const jsonRpcRequest = JSON.parse(request.body) as JsonRpcRequest;

    // Validate JSON-RPC structure
    if (jsonRpcRequest.jsonrpc !== '2.0' || !jsonRpcRequest.method) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': ['application/json'] },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: jsonRpcRequest.id ?? null,
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
        }),
      };
    }

    const response = await handleMcpRequest(jsonRpcRequest);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': ['application/json'] },
      body: JSON.stringify(response),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': ['application/json'] },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: `Internal error: ${message}` },
      }),
    };
  }
}
