import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Input for starting MCP discovery workflow
 */
export const DiscoveryInputSchema = z
  .object({
    transport: z.enum(['http', 'stdio']).describe('Transport type for MCP server'),
    name: z.string().min(1).max(191).describe('Human-readable name for the MCP server'),
    endpoint: z.string().url().optional().describe('HTTP endpoint for HTTP transport'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('HTTP headers for authentication'),
    command: z.string().optional().describe('Command to run for stdio transport'),
    args: z.array(z.string()).optional().describe('Arguments for stdio command'),
    cacheToken: z
      .string()
      .uuid()
      .optional()
      .describe('Cache token for storing/retrieving discovery results'),
  })
  .refine(
    (data) => {
      // HTTP transport requires endpoint
      if (data.transport === 'http') {
        return !!data.endpoint;
      }
      // stdio transport requires command
      if (data.transport === 'stdio') {
        return !!data.command;
      }
      return true;
    },
    {
      message: 'HTTP transport requires endpoint, stdio transport requires command',
      path: ['transport'],
    },
  );

export class DiscoveryInputDto extends createZodDto(DiscoveryInputSchema) {}

/**
 * Response for starting discovery workflow
 */
export const DiscoveryStartResponseSchema = z.object({
  workflowId: z.string().uuid().describe('Unique ID for tracking the discovery workflow'),
  cacheToken: z
    .string()
    .uuid()
    .optional()
    .describe('Cache token for retrieving cached discovery results'),
  status: z.literal('started').describe('Status indicating workflow has started'),
});

export class DiscoveryStartResponseDto extends createZodDto(DiscoveryStartResponseSchema) {}

/**
 * MCP tool discovered from server
 */
export const McpToolSchema = z.object({
  name: z.string().describe('Tool name'),
  description: z.string().optional().describe('Tool description'),
  inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for tool input'),
});

export class McpToolDto extends createZodDto(McpToolSchema) {}

/**
 * Discovery workflow status response
 */
export const DiscoveryStatusSchema = z
  .object({
    workflowId: z.string().uuid().describe('Workflow ID'),
    status: z.enum(['running', 'completed', 'failed']).describe('Current status of discovery'),
    tools: z
      .array(McpToolSchema)
      .optional()
      .describe('Discovered tools (available when completed)'),
    toolCount: z.number().int().nonnegative().optional().describe('Number of tools discovered'),
    error: z.string().optional().describe('Error message if discovery failed'),
    errorCode: z.string().optional().describe('Error code for categorizing failures'),
  })
  .strict();

export class DiscoveryStatusDto extends createZodDto(DiscoveryStatusSchema) {}

/**
 * Query result handler for Temporal workflow
 */
export interface DiscoveryWorkflowResult {
  status: 'completed' | 'failed';
  tools?: McpToolDto[];
  toolCount?: number;
  error?: string;
  errorCode?: string;
}
