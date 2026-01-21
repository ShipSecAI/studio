import { ToolInputSchema } from '@shipsec/component-sdk';

/**
 * Input for registering a component tool
 */
export class RegisterComponentToolInput {
  runId!: string;
  nodeId!: string;
  toolName!: string;
  componentId!: string;
  description!: string;
  inputSchema!: ToolInputSchema;
  credentials!: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}

/**
 * Input for registering a remote MCP
 */
export class RegisterRemoteMcpInput {
  runId!: string;
  nodeId!: string;
  toolName!: string;
  description!: string;
  inputSchema!: ToolInputSchema;
  endpoint!: string;
  authToken?: string;
}

/**
 * Input for registering a local MCP (stdio container)
 */
export class RegisterLocalMcpInput {
  runId!: string;
  nodeId!: string;
  toolName!: string;
  description!: string;
  inputSchema!: ToolInputSchema;
  endpoint!: string;
  containerId!: string;
}
