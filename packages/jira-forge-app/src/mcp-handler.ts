import type { JsonRpcRequest, JsonRpcResponse, McpToolDefinition, McpToolResult } from './types';
import { issueTools, handleIssueTool } from './tools/issues';
import { projectTools, handleProjectTool } from './tools/projects';
import { userTools, handleUserTool } from './tools/users';

const SERVER_INFO = {
  name: 'shipsec-jira-mcp',
  version: '1.0.0',
};

const allTools: McpToolDefinition[] = [...issueTools, ...projectTools, ...userTools];

const issueToolNames = new Set(issueTools.map((t) => t.name));
const projectToolNames = new Set(projectTools.map((t) => t.name));
const userToolNames = new Set(userTools.map((t) => t.name));

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  if (issueToolNames.has(name)) return handleIssueTool(name, args);
  if (projectToolNames.has(name)) return handleProjectTool(name, args);
  if (userToolNames.has(name)) return handleUserTool(name, args);
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        },
      };

    case 'notifications/initialized':
      // Client acknowledgment — no response needed for notifications
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: allTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };

    case 'tools/call': {
      const toolName = (params as Record<string, unknown>)?.name as string;
      const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<
        string,
        unknown
      >;

      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name in params.name' },
        };
      }

      try {
        const result = await handleToolCall(toolName, toolArgs);
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Tool execution error: ${message}` }],
            isError: true,
          },
        };
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
