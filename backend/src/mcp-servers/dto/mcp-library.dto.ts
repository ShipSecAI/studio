import { z } from 'zod';

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['stdio', 'http', 'sse', 'websocket']),
  transport: z.object({
    // For stdio servers
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    // For HTTP servers
    endpoint: z.string().optional(),
  }),
  enabled: z.boolean(),
  healthStatus: z.enum(['healthy', 'unhealthy', 'unknown']),
  toolCount: z.number().optional(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSchema),
});

export type ListMcpServersResponse = z.infer<typeof ListMcpServersResponseSchema>;
