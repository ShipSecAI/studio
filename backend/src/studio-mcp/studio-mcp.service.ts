import { Injectable, Optional } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  InMemoryTaskStore,
  InMemoryTaskMessageQueue,
} from '@modelcontextprotocol/sdk/experimental/index.js';
import { WorkflowsService } from '../workflows/workflows.service';
import { ArtifactsService } from '../storage/artifacts.service';
import { NodeIOService } from '../node-io/node-io.service';
import { TraceService } from '../trace/trace.service';
import { LogStreamService } from '../trace/log-stream.service';
import { SchedulesService } from '../schedules/schedules.service';
import { SecretsService } from '../secrets/secrets.service';
import { HumanInputsService } from '../human-inputs/human-inputs.service';
import type { AuthContext } from '../auth/types';
import type { StudioMcpDeps } from './tools/types';
import { registerWorkflowTools } from './tools/workflow.tools';
import { registerComponentTools } from './tools/component.tools';
import { registerRunTools } from './tools/run.tools';
import { registerArtifactTools } from './tools/artifact.tools';
import { registerScheduleTools } from './tools/schedule.tools';
import { registerSecretTools } from './tools/secret.tools';
import { registerHumanInputTools } from './tools/human-input.tools';

@Injectable()
export class StudioMcpService {
  private readonly taskStore = new InMemoryTaskStore();
  private readonly taskMessageQueue = new InMemoryTaskMessageQueue();

  constructor(
    private readonly workflowsService: WorkflowsService,
    @Optional() private readonly artifactsService?: ArtifactsService,
    @Optional() private readonly nodeIOService?: NodeIOService,
    @Optional() private readonly traceService?: TraceService,
    @Optional() private readonly logStreamService?: LogStreamService,
    @Optional() private readonly schedulesService?: SchedulesService,
    @Optional() private readonly secretsService?: SecretsService,
    @Optional() private readonly humanInputsService?: HumanInputsService,
  ) {}

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
      artifactsService: this.artifactsService,
      nodeIOService: this.nodeIOService,
      traceService: this.traceService,
      logStreamService: this.logStreamService,
      schedulesService: this.schedulesService,
      secretsService: this.secretsService,
      humanInputsService: this.humanInputsService,
    };

    registerWorkflowTools(server, auth, deps);
    registerComponentTools(server);
    registerRunTools(server, auth, deps);
    registerArtifactTools(server, auth, deps);
    registerScheduleTools(server, auth, deps);
    registerSecretTools(server, auth, deps);
    registerHumanInputTools(server, auth, deps);
  }
}
