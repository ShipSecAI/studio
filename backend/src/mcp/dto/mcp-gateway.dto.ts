import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ListToolsQuerySchema = z.object({
  runId: z.string().describe('The workflow run ID to list tools for'),
});

export class ListToolsQueryDto extends createZodDto(ListToolsQuerySchema) {}

export const CallToolRequestSchema = z.object({
  runId: z.string().describe('The workflow run ID'),
  name: z.string().describe('The tool name to call'),
  arguments: z.record(z.string(), z.unknown()).describe('The arguments for the tool call'),
});

export class CallToolRequestDto extends createZodDto(CallToolRequestSchema) {}

export const RegisterToolRequestSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  toolName: z.string(),
  componentId: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()),
  type: z.enum(['component', 'remote-mcp', 'local-mcp']),
  endpoint: z.string().optional(),
  containerId: z.string().optional(),
});

export class RegisterToolRequestDto extends createZodDto(RegisterToolRequestSchema) {}

export interface McpToolResponse {
  tools: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
}

export interface McpCallToolResponse {
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    [key: string]: unknown;
  }[];
  isError?: boolean;
}
