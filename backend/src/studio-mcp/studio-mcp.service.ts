import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  InMemoryTaskStore,
  InMemoryTaskMessageQueue,
} from '@modelcontextprotocol/sdk/experimental/index.js';
import { WorkflowsService } from '../workflows/workflows.service';
import type { AuthContext } from '../auth/types';
import type { StudioMcpDeps } from './tools/types';
import { registerWorkflowTools } from './tools/workflow.tools';
import { registerComponentTools } from './tools/component.tools';
import { registerRunTools } from './tools/run.tools';

@Injectable()
export class StudioMcpService {
  private readonly taskStore = new InMemoryTaskStore();
  private readonly taskMessageQueue = new InMemoryTaskMessageQueue();

  constructor(private readonly workflowsService: WorkflowsService) {}

  /**
   * Create an MCP server with all Studio tools registered, scoped to the given auth context.
   * Uses Streamable HTTP transport only (no legacy SSE).
   */
  createServer(auth: AuthContext): McpServer {
    const server = new McpServer(
      {
        name: 'shipsec-studio',
        version: '1.0.0',
      },
      {
        capabilities: {
          logging: {},
          tasks: { requests: { tools: { call: {} } } },
        },
        taskStore: this.taskStore,
        taskMessageQueue: this.taskMessageQueue,
      },
    );

    this.registerTools(server, auth);

    return server;
  }

  private registerTools(server: McpServer, auth: AuthContext): void {
    const deps: StudioMcpDeps = {
      workflowsService: this.workflowsService,
    };

    registerWorkflowTools(server, auth, deps);
    registerComponentTools(server);
    registerRunTools(server, auth, deps);
  }
}
