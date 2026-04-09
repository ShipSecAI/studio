// MCP JSON-RPC Protocol Types

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface WebTriggerRequest {
  method: string;
  headers: Record<string, string[]>;
  body: string;
  queryParameters: Record<string, string[]>;
  path: string;
}

export interface WebTriggerResponse {
  statusCode: number;
  headers: Record<string, string[]>;
  body: string;
}
