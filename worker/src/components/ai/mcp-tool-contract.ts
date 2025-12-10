import { z } from 'zod';
import { registerContract } from '@shipsec/component-sdk';

export const mcpToolContractName = 'core.ai.mcp-tool.v1';

export const McpToolArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  required: z.boolean().default(true),
  enum: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .nonempty()
    .optional()
    .describe('Optional set of allowed values for dropdown-like arguments.'),
});

export const McpToolDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  endpoint: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  metadata: z
    .object({
      toolName: z.string().optional(),
      source: z.string().optional(),
    })
    .optional(),
  arguments: z.array(McpToolArgumentSchema).optional(),
});

registerContract({
  name: mcpToolContractName,
  schema: McpToolDefinitionSchema,
  summary: 'Normalized MCP tool definition (id, endpoint, headers, metadata).',
  description:
    'Represents a single MCP tool entry that the AI agent can call, including optional structured arguments.',
});
