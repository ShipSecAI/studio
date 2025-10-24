import { randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { compileWorkflowGraph } from '../dsl/compiler';
import { WorkflowDefinition } from '../dsl/types';
import {
  TemporalService,
  type WorkflowRunStatus as TemporalWorkflowRunStatus,
} from '../temporal/temporal.service';
import { WorkflowGraphDto, WorkflowGraphSchema, WorkflowResponse, ServiceWorkflowResponse } from './dto/workflow-graph.dto';
import {
  WorkflowRecord,
  WorkflowRepository,
} from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { TraceRepository } from '../trace/trace.repository';
import {
  ExecutionStatus,
  FailureSummary,
  WorkflowRunStatusPayload,
  TraceEventPayload,
} from '@shipsec/shared';

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
}

export interface WorkflowRunHandle {
  runId: string;
  workflowId: string;
  temporalRunId: string;
  status: ExecutionStatus;
  taskQueue: string;
}

const SHIPSEC_WORKFLOW_TYPE = 'shipsecWorkflowRun';

export interface DataFlowPacketDto {
  id: string;
  runId: string;
  sourceNode: string;
  targetNode: string;
  inputKey: string;
  payload: unknown;
  timestamp: number;
  visualTime: number;
  size: number;
  type: 'file' | 'json' | 'text' | 'binary';
}

interface FlowContext {
  workflowId: string;
  definition: WorkflowDefinition;
  targetsBySource: Map<
    string,
    Array<{
      targetRef: string;
      sourceHandle: string;
      inputKey: string;
    }>
  >;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);
  private readonly flowContexts = new Map<string, FlowContext>();

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly temporalService: TemporalService,
  ) {}

  async create(dto: WorkflowGraphDto): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);
    const record = await this.repository.create(input);
    const flattened = this.flattenWorkflowGraph(record);
    this.logger.log(
      `Created workflow ${flattened.id} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    return flattened;
  }

  async update(id: string, dto: WorkflowGraphDto): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);
    const record = await this.repository.update(id, input);
    const flattened = this.flattenWorkflowGraph(record);
    this.logger.log(
      `Updated workflow ${flattened.id} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    return flattened;
  }

  async findById(id: string): Promise<ServiceWorkflowResponse> {
    const record = await this.repository.findById(id);
    if (!record) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    return this.flattenWorkflowGraph(record);
  }

  private flattenWorkflowGraph(record: WorkflowRecord): ServiceWorkflowResponse {
    // Flatten graph.{nodes, edges, viewport} to top level for API compatibility
    return {
      ...record,
      nodes: record.graph.nodes,
      edges: record.graph.edges,
      viewport: record.graph.viewport,
    };
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
    this.logger.log(`Deleted workflow ${id}`);
  }

  async list(): Promise<ServiceWorkflowResponse[]> {
    const records = await this.repository.list();
    const flattened = records.map((record) => this.flattenWorkflowGraph(record));
    this.logger.log(`Loaded ${flattened.length} workflow(s) from repository`);
    return flattened;
  }

  private computeDuration(start: Date, end?: Date | null): number {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      return 0;
    }
    return Math.max(0, endTime - startTime);
  }

  async listRuns(options: {
    workflowId?: string;
    status?: ExecutionStatus;
    limit?: number;
  } = {}) {
    const runs = await this.runRepository.list(options);
    const enrichedRuns = [];

    for (const run of runs) {
      // Get workflow name
      const workflow = await this.repository.findById(run.workflowId);
      const workflowName = workflow?.name ?? 'Unknown Workflow';
      const graph = workflow?.graph as { nodes?: unknown[] } | undefined;
      const nodeCount = Array.isArray(graph?.nodes) ? graph!.nodes!.length : 0;

      // Get event count
      const eventCount = await this.traceRepository.countByType(run.runId, 'NODE_STARTED');

      // Get current status from Temporal
      let currentStatus = 'UNKNOWN';
      try {
        const status = await this.temporalService.describeWorkflow({
          workflowId: run.runId,
          runId: run.temporalRunId ?? undefined,
        });
        currentStatus = this.normalizeStatus(status.status);
      } catch (error) {
        this.logger.warn(`Failed to get status for run ${run.runId}: ${error}`);
      }

      enrichedRuns.push({
        id: run.runId,
        workflowId: run.workflowId,
        status: currentStatus,
        startTime: run.createdAt,
        endTime: run.updatedAt,
        temporalRunId: run.temporalRunId ?? undefined,
        workflowName,
        eventCount,
        nodeCount,
        duration: this.computeDuration(run.createdAt, run.updatedAt),
      });
    }

    // Sort by start time (newest first)
    enrichedRuns.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    this.logger.log(`Loaded ${enrichedRuns.length} workflow run(s) for timeline`);
    return { runs: enrichedRuns };
  }

  async commit(id: string): Promise<WorkflowDefinition> {
    const workflow = await this.findById(id);
    this.logger.log(`Compiling workflow ${workflow.id}`);
    const definition = compileWorkflowGraph(workflow.graph);
    await this.repository.saveCompiledDefinition(id, definition);
    this.logger.log(
      `Compiled workflow ${workflow.id} with ${definition.actions.length} action(s); entrypoint=${definition.entrypoint.ref}`,
    );
    return definition;
  }

  async run(id: string, request: WorkflowRunRequest = {}): Promise<WorkflowRunHandle> {
    const workflow = await this.findById(id);
    const inputSummary = this.formatInputSummary(request.inputs);
    this.logger.log(
      `Received run request for workflow ${workflow.id} (inputs=${inputSummary})`,
    );

    let definition = workflow.compiledDefinition;
    const needsRecompile =
      !definition?.actions?.every((action: any) => action && 'inputMappings' in action);

    if (!definition || needsRecompile) {
      this.logger.log(`Recompiling workflow ${workflow.id} for latest schema`);
      definition = await this.commit(id);
    }

    if (!definition) {
      throw new Error(`Failed to compile workflow ${workflow.id}`);
    }
    const compiledDefinition = definition as WorkflowDefinition;
    const runId = `shipsec-run-${randomUUID()}`;

    // Track execution stats
    await this.repository.incrementRunCount(id);

    try {
      const temporalRun = await this.temporalService.startWorkflow({
        workflowType: SHIPSEC_WORKFLOW_TYPE,
        workflowId: runId,
        args: [
          {
            runId,
            workflowId: workflow.id,
            definition: compiledDefinition,
            inputs: request.inputs ?? {},
          },
        ],
      });

      this.logger.log(
        `Started workflow run ${runId} (temporalRunId=${temporalRun.runId}, taskQueue=${temporalRun.taskQueue}, actions=${compiledDefinition.actions.length})`,
      );

      await this.runRepository.upsert({
        runId,
        workflowId: workflow.id,
        temporalRunId: temporalRun.runId,
        totalActions: compiledDefinition.actions.length,
      });

      return {
        runId,
        workflowId: workflow.id,
        temporalRunId: temporalRun.runId,
        status: 'RUNNING',
        taskQueue: temporalRun.taskQueue,
      };
    } catch (error) {
      this.logger.error(
        `Failed to start workflow ${workflow.id} run ${runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async getRunStatus(
    runId: string,
    temporalRunId?: string,
  ): Promise<WorkflowRunStatusPayload> {
    this.logger.log(
      `Fetching status for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const temporalStatus = await this.temporalService.describeWorkflow({
      workflowId: runId,
      runId: temporalRunId,
    });
    const metadata = await this.runRepository.findByRunId(runId);

    let completedActions = 0;
    if (metadata?.totalActions && metadata.totalActions > 0) {
      completedActions = await this.traceRepository.countByType(runId, 'NODE_COMPLETED');
    }

    return this.mapTemporalStatus(runId, temporalStatus, metadata ?? null, completedActions);
  }

  async getRunResult(runId: string, temporalRunId?: string) {
    this.logger.log(
      `Fetching result for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    return this.temporalService.getWorkflowResult({ workflowId: runId, runId: temporalRunId });
  }

  async cancelRun(runId: string, temporalRunId?: string): Promise<void> {
    this.logger.warn(
      `Cancelling workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    await this.temporalService.cancelWorkflow({ workflowId: runId, runId: temporalRunId });
  }

  async buildDataFlows(
    runId: string,
    events: TraceEventPayload[],
    options: { baseTimestamp?: number; latestTimestamp?: number } = {},
  ): Promise<DataFlowPacketDto[]> {
    if (!events || events.length === 0) {
      return [];
    }

    const context = await this.getFlowContext(runId);
    const packets: DataFlowPacketDto[] = [];

    let earliest = options.baseTimestamp ?? null;
    let latest = options.latestTimestamp ?? null;

    for (const event of events) {
      if (event.type !== 'COMPLETED' || !event.nodeId) {
        continue;
      }

      const targets = context.targetsBySource.get(event.nodeId);
      if (!targets || targets.length === 0) {
        continue;
      }

      const summary = event.outputSummary as Record<string, unknown> | undefined;
      if (!summary || Object.keys(summary).length === 0) {
        continue;
      }

      const timestamp = Date.parse(event.timestamp);
      if (Number.isNaN(timestamp)) {
        continue;
      }

      if (earliest === null || timestamp < earliest) {
        earliest = timestamp;
      }
      if (latest === null || timestamp > latest) {
        latest = timestamp;
      }

      let index = 0;
      for (const target of targets) {
        const payload = this.resolveMappingValue(summary, target.sourceHandle);
        if (payload === undefined) {
          continue;
        }

        packets.push({
          id: `${runId}:${event.id ?? 'event'}:${target.targetRef}:${index++}`,
          runId,
          sourceNode: event.nodeId,
          targetNode: target.targetRef,
          inputKey: target.inputKey,
          payload,
          timestamp,
          size: this.estimatePayloadSize(payload),
          type: this.inferPayloadType(payload),
          visualTime: 0,
        });
      }
    }

    if (packets.length === 0) {
      return packets;
    }

    packets.sort((a, b) => a.timestamp - b.timestamp);

    const base = options.baseTimestamp ?? earliest ?? packets[0].timestamp;
    const top = options.latestTimestamp ?? latest ?? packets[packets.length - 1].timestamp;
    const span = Math.max(1, top - base);

    packets.forEach((packet) => {
      packet.visualTime = (packet.timestamp - base) / span;
    });

    return packets;
  }

  async releaseFlowContext(runId: string): Promise<void> {
    this.flowContexts.delete(runId);
  }

  private async getFlowContext(runId: string): Promise<FlowContext> {
    const cached = this.flowContexts.get(runId);
    if (cached) {
      return cached;
    }

    const run = await this.runRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const workflow = await this.repository.findById(run.workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${run.workflowId} not found for run ${runId}`);
    }

    const definition = this.ensureDefinition(workflow);
    const targetsBySource = this.buildTargetsIndex(definition);

    const context: FlowContext = {
      workflowId: workflow.id,
      definition,
      targetsBySource,
    };

    this.flowContexts.set(runId, context);
    return context;
  }

  private ensureDefinition(workflow: WorkflowRecord): WorkflowDefinition {
    if (workflow.compiledDefinition) {
      return workflow.compiledDefinition as WorkflowDefinition;
    }

    const graph = WorkflowGraphSchema.parse(workflow.graph);
    return compileWorkflowGraph(graph);
  }

  private buildTargetsIndex(
    definition: WorkflowDefinition,
  ): FlowContext['targetsBySource'] {
    const map = new Map<string, Array<{ targetRef: string; sourceHandle: string; inputKey: string }>>();

    for (const action of definition.actions) {
      const mappings = action.inputMappings ?? {};
      for (const [inputKey, mapping] of Object.entries(mappings)) {
        const list = map.get(mapping.sourceRef) ?? [];
        list.push({
          targetRef: action.ref,
          sourceHandle: mapping.sourceHandle,
          inputKey,
        });
        map.set(mapping.sourceRef, list);
      }
    }

    return map;
  }

  private resolveMappingValue(
    sourceOutput: Record<string, unknown> | undefined,
    sourceHandle: string,
  ): unknown {
    if (!sourceOutput) {
      return undefined;
    }

    if (sourceHandle === '__self__') {
      return sourceOutput;
    }

    if (Object.prototype.hasOwnProperty.call(sourceOutput, sourceHandle)) {
      return sourceOutput[sourceHandle];
    }

    return undefined;
  }

  private inferPayloadType(value: unknown): 'file' | 'json' | 'text' | 'binary' {
    if (typeof value === 'string') {
      return 'text';
    }
    if (value && typeof value === 'object') {
      return 'json';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return 'json';
    }
    return 'binary';
  }

  private estimatePayloadSize(value: unknown): number {
    try {
      if (typeof value === 'string') {
        return Buffer.byteLength(value, 'utf8');
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return Buffer.byteLength(String(value), 'utf8');
      }
      if (value && typeof value === 'object') {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
      }
    } catch (error) {
      this.logger.warn(`Failed to estimate payload size: ${error}`);
    }
    return 0;
  }

  private parse(dto: WorkflowGraphDto) {
    return WorkflowGraphSchema.parse(dto);
  }

  private formatInputSummary(inputs?: Record<string, unknown>): string {
    if (!inputs || Object.keys(inputs).length === 0) {
      return 'none';
    }

    return Object.entries(inputs)
      .map(([key, value]) => `${key}=${this.describeValue(value)}`)
      .join(', ');
  }

  private describeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return String(value);
    }

    if (Array.isArray(value)) {
      return `array(len=${value.length})`;
    }

    if (typeof value === 'object') {
      return 'object';
    }

    if (typeof value === 'string') {
      if (value.length <= 48) {
        return value;
      }

      return `${value.slice(0, 48)}… (len=${value.length})`;
    }

    return String(value);
  }

  private mapTemporalStatus(
    requestedRunId: string,
    status: TemporalWorkflowRunStatus,
    metadata: { workflowId: string; totalActions: number } | null,
    completedActions: number,
  ): WorkflowRunStatusPayload {
    const normalizedStatus = this.normalizeStatus(status.status);
    const completedAt = status.closeTime ?? undefined;
    const workflowId = metadata?.workflowId ?? requestedRunId;
    const totalActions = metadata?.totalActions ?? 0;
    const progress = totalActions > 0
      ? {
          completedActions: Math.min(completedActions, totalActions),
          totalActions,
        }
      : undefined;

    return {
      runId: requestedRunId,
      workflowId,
      status: normalizedStatus,
      startedAt: status.startTime,
      updatedAt: new Date().toISOString(),
      completedAt,
      taskQueue: status.taskQueue,
      historyLength: status.historyLength,
      progress,
      failure: this.buildFailure(normalizedStatus, status.failure),
    };
  }

  private normalizeStatus(status: string): ExecutionStatus {
    switch (status) {
      case 'RUNNING':
        return 'RUNNING';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'FAILED':
        return 'FAILED';
      case 'CANCELED':
        return 'CANCELLED';
      case 'TERMINATED':
        return 'TERMINATED';
      case 'TIMED_OUT':
        return 'TIMED_OUT';
      case 'CONTINUED_AS_NEW':
        return 'RUNNING';
      default:
        this.logger.warn(`Unknown Temporal status '${status}', defaulting to RUNNING`);
        return 'RUNNING';
    }
  }

  private buildFailure(status: ExecutionStatus, failure?: unknown): FailureSummary | undefined {
    if (!['FAILED', 'TERMINATED', 'TIMED_OUT'].includes(status)) {
      return undefined;
    }

    const failureObj = failure as any;
    if (!failureObj) {
      return {
        reason: `Workflow run ended with status ${status}`,
      };
    }

    const reason: string = failureObj.message ?? `Workflow run ended with status ${status}`;
    const temporalCode: string | undefined =
      failureObj.applicationFailureInfo?.type ??
      failureObj.timeoutFailureInfo?.timeoutType ??
      failureObj.terminatedFailureInfo?.reason ??
      failureObj.serverFailureInfo?.nonRetryable?.toString() ??
      failureObj.code;

    const details: Record<string, unknown> = {};
    if (failureObj.stackTrace) {
      details.stackTrace = failureObj.stackTrace;
    }
    if (failureObj.applicationFailureInfo?.details) {
      details.applicationFailureDetails = failureObj.applicationFailureInfo.details;
    }

    return {
      reason,
      temporalCode,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }
}
