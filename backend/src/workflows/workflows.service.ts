import { randomUUID, createHash } from 'node:crypto';

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { status as grpcStatus, type ServiceError } from '@grpc/grpc-js';
import { WorkflowNotFoundError } from '@temporalio/client';
import { z } from 'zod';

import { compileWorkflowGraph } from '../dsl/compiler';
// Ensure all worker components are registered before accessing the registry
import '@shipsec/studio-worker/components';
import { componentRegistry, extractPorts } from '@shipsec/component-sdk';
import { WorkflowDefinition } from '../dsl/types';
import {
  TemporalService,
  type WorkflowRunStatus as TemporalWorkflowRunStatus,
} from '../temporal/temporal.service';
import {
  WorkflowGraphDto,
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  WorkflowNodeDataSchema,
  ServiceWorkflowResponse,
  UpdateWorkflowMetadataDto,
} from './dto/workflow-graph.dto';
import { WorkflowRecord, WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { TraceRepository } from '../trace/trace.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  ExecutionStatus,
  FailureSummary,
  WorkflowRunStatusPayload,
  TraceEventPayload,
  WorkflowRunConfigPayload,
  ExecutionTriggerType,
  ExecutionInputPreview,
  ExecutionTriggerMetadata,
  TERMINAL_STATUSES,
} from '@shipsec/shared';
import type { WorkflowRunRecord, WorkflowVersionRecord, WorkflowGraph } from '../database/schema';
import type { AuthContext } from '../auth/types';

export interface WorkflowSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  lastRun: string | null;
  latestRunStatus: string | null;
  runCount: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunRequest {
  inputs?: Record<string, unknown>;
  versionId?: string;
  version?: number;
}

export interface WorkflowRunHandle {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  temporalRunId: string;
  status: ExecutionStatus;
  taskQueue: string;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  organizationId: string;
  workflowVersionId: string | null;
  workflowVersion: number | null;
  status: ExecutionStatus;
  startTime: Date;
  endTime?: Date | null;
  temporalRunId?: string;
  workflowName: string;
  eventCount: number;
  nodeCount: number;
  duration: number;
  triggerType: ExecutionTriggerType;
  triggerSource?: string | null;
  triggerLabel?: string | null;
  inputPreview: ExecutionInputPreview;
  parentRunId?: string | null;
  parentNodeRef?: string | null;
}

const SHIPSEC_WORKFLOW_TYPE = 'shipsecWorkflowRun';
export interface PreparedRunPayload {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  organizationId: string;
  definition: WorkflowDefinition;
  inputs: Record<string, unknown>;
  triggerMetadata: ExecutionTriggerMetadata;
  inputPreview: ExecutionInputPreview;
  totalActions: number;
}

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
  workflowVersionId: string;
  workflowVersion: number;
  definition: WorkflowDefinition;
  targetsBySource: Map<
    string,
    {
      targetRef: string;
      sourceHandle: string;
      inputKey: string;
    }[]
  >;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);
  private readonly flowContexts = new Map<string, FlowContext>();

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly roleRepository: WorkflowRoleRepository,
    private readonly versionRepository: WorkflowVersionRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
    private readonly temporalService: TemporalService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private resolveOrganizationId(auth?: AuthContext | null): string | null {
    return auth?.organizationId ?? null;
  }

  async ensureWorkflowAdminAccess(workflowId: string, auth?: AuthContext | null): Promise<string> {
    return this.requireWorkflowAdmin(workflowId, auth);
  }

  private normalizeIdempotencyKey(key?: string | null): string | undefined {
    if (!key) {
      return undefined;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed.slice(0, 128);
  }

  private runIdFromIdempotencyKey(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return `shipsec-run-${hash}`;
  }

  async getCompiledWorkflowContext(
    workflowId: string,
    request: WorkflowRunRequest = {},
    auth?: AuthContext | null,
  ): Promise<{
    workflow: WorkflowRecord;
    version: WorkflowVersionRecord;
    definition: WorkflowDefinition;
    organizationId: string;
  }> {
    const organizationId = this.requireOrganizationId(auth);
    const workflow = await this.repository.findById(workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflo w ${workflowId} not found`);
    }
    const version = await this.resolveWorkflowVersion(workflowId, request, organizationId);
    const definition = await this.ensureDefinitionForVersion(workflow, version, organizationId);
    return {
      workflow,
      version,
      definition,
      organizationId,
    };
  }

  private requireOrganizationId(auth?: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }

  private ensureOrganizationAdmin(auth?: AuthContext | null): void {
    this.logger.debug(
      `[WORKFLOWS] Checking org admin - Auth: ${auth ? 'present' : 'null'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}, User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}`,
    );
    if (!auth?.roles || !auth.roles.includes('ADMIN')) {
      this.logger.warn(
        `[WORKFLOWS] Access denied - User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}`,
      );
      throw new ForbiddenException('Administrator role required');
    }
    this.logger.debug(`[WORKFLOWS] Org admin check passed for user: ${auth.userId}`);
  }

  private async requireWorkflowAdmin(
    workflowId: string,
    auth?: AuthContext | null,
  ): Promise<string> {
    const organizationId = this.requireOrganizationId(auth);
    if (auth?.roles?.includes('ADMIN')) {
      return organizationId;
    }

    if (!auth?.userId) {
      throw new ForbiddenException('Administrator role required');
    }

    const hasRole = await this.roleRepository.hasRole({
      workflowId,
      userId: auth.userId,
      role: 'ADMIN',
      organizationId,
    });

    if (!hasRole) {
      throw new ForbiddenException('Administrator role required');
    }

    return organizationId;
  }

  private async requireRunAccess(runId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    return { organizationId, run };
  }

  async resolveRunForAccess(runId: string, auth?: AuthContext | null) {
    return this.requireRunAccess(runId, auth);
  }

  async resolveRunWithoutAuth(runId: string) {
    const run = await this.runRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    return {
      organizationId: run.organizationId ?? null,
      run,
    };
  }

  async ensureRunAccess(runId: string, auth?: AuthContext | null): Promise<void> {
    await this.requireRunAccess(runId, auth);
  }

  async create(dto: WorkflowGraphDto, auth?: AuthContext | null): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);

    // Validate workflow graph before saving (including port connections)
    try {
      compileWorkflowGraph(input);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(`Workflow validation failed: ${error.message}`);
      }
      throw error;
    }

    this.ensureOrganizationAdmin(auth);
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.create(input, { organizationId });
    let version: WorkflowVersionRecord;
    try {
      version = await this.versionRepository.create({
        workflowId: record.id,
        graph: input,
        organizationId,
      });
      if (auth?.userId) {
        await this.roleRepository.upsert({
          workflowId: record.id,
          userId: auth.userId,
          role: 'ADMIN',
          organizationId,
        });
      }
    } catch (error) {
      await this.repository.delete(record.id, { organizationId });
      throw error;
    }
    const response = this.buildWorkflowResponse(record, version);
    this.logger.log(
      `Created workflow ${response.id} version ${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    return response;
  }

  async update(
    id: string,
    dto: WorkflowGraphDto,
    auth?: AuthContext | null,
  ): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);

    // Validate workflow graph before saving (including port connections)
    try {
      compileWorkflowGraph(input);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(`Workflow validation failed: ${error.message}`);
      }
      throw error;
    }

    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const record = await this.repository.update(id, input, { organizationId });
    const version = await this.versionRepository.create({
      workflowId: record.id,
      graph: input,
      organizationId,
    });
    const response = this.buildWorkflowResponse(record, version);
    this.logger.log(
      `Updated workflow ${response.id} to version ${version.version} (nodes=${input.nodes.length}, edges=${input.edges.length})`,
    );
    return response;
  }

  async updateMetadata(
    id: string,
    dto: UpdateWorkflowMetadataDto,
    auth?: AuthContext | null,
  ): Promise<ServiceWorkflowResponse> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const record = await this.repository.updateMetadata(
      id,
      { name: dto.name, description: dto.description ?? null },
      { organizationId },
    );
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    const response = this.buildWorkflowResponse(record, version ?? null);
    this.logger.log(`Updated workflow ${response.id} metadata (name=${dto.name})`);
    return response;
  }

  async findById(id: string, auth?: AuthContext | null): Promise<ServiceWorkflowResponse> {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findById(id, { organizationId });
    if (!record) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    const version = await this.versionRepository.findLatestByWorkflowId(id, { organizationId });
    return this.buildWorkflowResponse(record, version ?? null);
  }

  private buildWorkflowResponse(
    record: WorkflowRecord,
    version?: WorkflowVersionRecord | null,
  ): ServiceWorkflowResponse {
    // Resolve dynamic ports for the graph so Entry Point nodes show correct outputs
    const resolvedGraph = this.resolveGraphPorts(record.graph);

    return {
      ...record,
      graph: resolvedGraph,
      currentVersionId: version?.id ?? null,
      currentVersion: version?.version ?? null,
    };
  }

  /**
   * Extract component parameters from node data, handling legacy schema formats.
   * This handles the migration from old formats where params might be at:
   * - nodeData.config.params (current schema)
   * - nodeData.parameters (legacy)
   * - nodeData.config (legacy - when config was the params object directly)
   */
  private extractNodeParams(
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): Record<string, unknown> {
    // Current schema: params are in config.params
    if (nodeData.config?.params && Object.keys(nodeData.config.params).length > 0) {
      return nodeData.config.params;
    }

    // Legacy: params stored directly on nodeData (via extended properties)
    const extendedNodeData = nodeData as Record<string, unknown>;
    if (extendedNodeData.parameters && typeof extendedNodeData.parameters === 'object') {
      return extendedNodeData.parameters as Record<string, unknown>;
    }

    // Legacy: config was the params object itself (before nested config.params structure)
    // Only use this if config doesn't have the modern structure
    if (
      nodeData.config &&
      !('params' in nodeData.config) &&
      !('inputOverrides' in nodeData.config) &&
      typeof nodeData.config === 'object'
    ) {
      return nodeData.config as Record<string, unknown>;
    }

    return {};
  }

  /**
   * Extract component ID from node, handling frontend extensions.
   * The componentId might be in node.type or in extended nodeData properties.
   */
  private extractComponentId(
    node: z.infer<typeof WorkflowNodeSchema>,
    nodeData: z.infer<typeof WorkflowNodeDataSchema>,
  ): string | null {
    // In backend schema, node.type contains the component ID
    if (node.type && node.type !== 'workflow') {
      return node.type;
    }

    // Frontend extensions might store componentId/componentSlug in nodeData
    const extendedNodeData = nodeData as Record<string, unknown>;
    if (typeof extendedNodeData.componentId === 'string') {
      return extendedNodeData.componentId;
    }
    if (typeof extendedNodeData.componentSlug === 'string') {
      return extendedNodeData.componentSlug;
    }

    return null;
  }

  /**
   * Resolve dynamic ports for a single node based on its component and parameters.
   */
  private resolveNodePorts(
    node: z.infer<typeof WorkflowNodeSchema>,
  ): z.infer<typeof WorkflowNodeSchema> {
    const nodeData = node.data;
    const componentId = this.extractComponentId(node, nodeData);

    if (!componentId) {
      return node;
    }

    try {
      const entry = componentRegistry.getMetadata(componentId);
      if (!entry) {
        return node;
      }
      const component = entry.definition;
      const baseInputs = entry.inputs ?? extractPorts(component.inputs);
      const baseOutputs = entry.outputs ?? extractPorts(component.outputs);

      const params = this.extractNodeParams(nodeData);

      if (typeof component.resolvePorts === 'function') {
        try {
          const resolved = component.resolvePorts(params);
          return {
            ...node,
            data: {
              ...nodeData,
              dynamicInputs: resolved.inputs ? extractPorts(resolved.inputs) : baseInputs,
              dynamicOutputs: resolved.outputs ? extractPorts(resolved.outputs) : baseOutputs,
            },
          };
        } catch (resolveError) {
          this.logger.warn(`Failed to resolve ports for component ${componentId}: ${resolveError}`);
          return {
            ...node,
            data: {
              ...nodeData,
              dynamicInputs: baseInputs,
              dynamicOutputs: baseOutputs,
            },
          };
        }
      } else {
        return {
          ...node,
          data: {
            ...nodeData,
            dynamicInputs: baseInputs,
            dynamicOutputs: baseOutputs,
          },
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to get component ${componentId} for port resolution: ${error}`);
      return node;
    }
  }

  /**
   * Resolve dynamic ports for all nodes in a workflow graph.
   * This ensures Entry Point nodes and other components with resolvePorts
   * have their dynamicInputs/dynamicOutputs populated correctly.
   */
  private resolveGraphPorts(graph: WorkflowGraph): WorkflowGraph {
    if (!graph || !Array.isArray(graph.nodes)) {
      return graph;
    }

    return {
      ...graph,
      nodes: graph.nodes.map((node) => this.resolveNodePorts(node)),
    };
  }

  async delete(id: string, auth?: AuthContext | null): Promise<void> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    await this.repository.delete(id, { organizationId });
    this.logger.log(`Deleted workflow ${id}`);
  }

  async list(auth?: AuthContext | null): Promise<ServiceWorkflowResponse[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.list({ organizationId });
    const versions = await Promise.all(
      records.map((record) =>
        this.versionRepository.findLatestByWorkflowId(record.id, { organizationId }),
      ),
    );
    const responses = records.map((record, index) =>
      this.buildWorkflowResponse(record, versions[index] ?? null),
    );
    this.logger.log(`Loaded ${responses.length} workflow(s) from repository`);
    return responses;
  }

  async listSummary(auth?: AuthContext | null): Promise<WorkflowSummaryResponse[]> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listSummary({ organizationId });
    return records.map((record) => ({
      ...record,
      lastRun: record.lastRun?.toISOString() ?? null,
      latestRunStatus: record.latestRunStatus ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  private computeDuration(start: Date, end?: Date | null): number {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      return 0;
    }
    return Math.max(0, endTime - startTime);
  }

  private async buildRunSummary(
    run: WorkflowRunRecord,
    organizationId: string,
  ): Promise<WorkflowRunSummary> {
    const workflow = await this.repository.findById(run.workflowId, { organizationId });
    const workflowName = workflow?.name ?? 'Unknown Workflow';
    const version = run.workflowVersionId
      ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
      : workflow
        ? await this.versionRepository.findLatestByWorkflowId(workflow.id, { organizationId })
        : undefined;
    const graph = (version?.graph ?? workflow?.graph) as { nodes?: unknown[] } | undefined;
    const nodeCount = graph?.nodes && Array.isArray(graph.nodes) ? graph.nodes.length : 0;

    // Get trace event counts for status inference
    const [startedActions, completedActions, failedActions] = await Promise.all([
      this.traceRepository.countByType(run.runId, 'NODE_STARTED', organizationId),
      this.traceRepository.countByType(run.runId, 'NODE_COMPLETED', organizationId),
      this.traceRepository.countByType(run.runId, 'NODE_FAILED', organizationId),
    ]);

    // Calculate duration from events (more accurate than createdAt/updatedAt)
    const eventTimeRange = await this.traceRepository.getEventTimeRange(run.runId, organizationId);
    const duration =
      eventTimeRange.firstTimestamp && eventTimeRange.lastTimestamp
        ? this.computeDuration(eventTimeRange.firstTimestamp, eventTimeRange.lastTimestamp)
        : this.computeDuration(run.createdAt, run.updatedAt);

    let currentStatus: ExecutionStatus = 'RUNNING';
    let resolvedCloseTime: string | null = null;

    // Cache-first: skip Temporal RPC for runs with a cached terminal status
    if (run.status && (TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      currentStatus = run.status as ExecutionStatus;
      resolvedCloseTime = run.closeTime?.toISOString() ?? null;
    } else {
      try {
        const desc = await this.temporalService.describeWorkflow({
          workflowId: run.runId,
          runId: run.temporalRunId ?? undefined,
        });
        currentStatus = this.normalizeStatus(desc.status);
        resolvedCloseTime = desc.closeTime ?? null;

        // Cache terminal statuses (fire-and-forget) so future reads skip Temporal
        if ((TERMINAL_STATUSES as readonly string[]).includes(currentStatus)) {
          this.runRepository
            .cacheTerminalStatus(
              run.runId,
              currentStatus,
              desc.closeTime ? new Date(desc.closeTime) : undefined,
            )
            .catch((err) => this.logger.warn(`Failed to cache status for ${run.runId}: ${err}`));
        }
      } catch (error) {
        // If Temporal can't find the workflow, infer status for display only — do NOT cache
        if (this.isNotFoundError(error)) {
          currentStatus = this.inferStatusFromTraceEvents({
            runId: run.runId,
            totalActions: run.totalActions ?? nodeCount,
            completedActions,
            failedActions,
            startedActions,
          });
          this.logger.log(
            `Run ${run.runId} not found in Temporal, inferred status: ${currentStatus} ` +
              `(started=${startedActions}, completed=${completedActions}, failed=${failedActions})`,
          );
        } else {
          this.logger.warn(`Failed to get status for run ${run.runId}: ${error}`);
        }
      }
    }

    const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual';
    const triggerSource = run.triggerSource ?? null;
    const triggerLabel = run.triggerLabel ?? (triggerType === 'manual' ? 'Manual run' : null);
    const inputPreview: ExecutionInputPreview = run.inputPreview ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    };

    return {
      id: run.runId,
      workflowId: run.workflowId,
      organizationId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      status: currentStatus,
      startTime: run.createdAt,
      endTime: resolvedCloseTime
        ? new Date(resolvedCloseTime)
        : (run.closeTime ?? run.updatedAt ?? null),
      temporalRunId: run.temporalRunId ?? undefined,
      workflowName,
      eventCount: startedActions,
      nodeCount,
      duration,
      triggerType,
      triggerSource,
      triggerLabel,
      inputPreview,
      parentRunId: run.parentRunId ?? null,
      parentNodeRef: run.parentNodeRef ?? null,
    };
  }

  async listRuns(
    auth?: AuthContext | null,
    options: {
      workflowId?: string;
      status?: ExecutionStatus;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const organizationId = this.requireOrganizationId(auth);
    const runs = await this.runRepository.list({
      ...options,
      organizationId,
    });
    const summaries = await Promise.all(
      runs.map((run) => this.buildRunSummary(run, organizationId)),
    );

    summaries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    this.logger.log(`Loaded ${summaries.length} workflow run(s) for timeline`);
    return { runs: summaries };
  }

  async listChildRuns(
    parentRunId: string,
    auth?: AuthContext | null,
    options: { limit?: number } = {},
  ): Promise<{
    runs: {
      runId: string;
      workflowId: string;
      workflowName: string;
      parentNodeRef: string | null;
      status: ExecutionStatus;
      startedAt: string;
      completedAt?: string;
    }[];
  }> {
    const { organizationId } = await this.requireRunAccess(parentRunId, auth);
    const children = await this.runRepository.listChildren(parentRunId, {
      organizationId,
      limit: options.limit,
    });

    const summaries = await Promise.all(
      children.map((run) => this.buildRunSummary(run, organizationId)),
    );

    const runs = summaries.map((summary, index) => ({
      runId: summary.id,
      workflowId: summary.workflowId,
      workflowName: summary.workflowName,
      parentNodeRef: children[index]?.parentNodeRef ?? null,
      status: summary.status,
      startedAt: new Date(summary.startTime).toISOString(),
      completedAt: summary.endTime ? new Date(summary.endTime).toISOString() : undefined,
    }));

    return { runs };
  }

  async getRun(runId: string, auth?: AuthContext | null): Promise<WorkflowRunSummary> {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    return this.buildRunSummary(run, organizationId);
  }

  async commit(id: string, auth?: AuthContext | null): Promise<WorkflowDefinition> {
    const organizationId = await this.requireWorkflowAdmin(id, auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    const version = await this.versionRepository.findLatestByWorkflowId(id, {
      organizationId,
    });
    if (!version) {
      throw new NotFoundException(`No versions recorded for workflow ${id}`);
    }

    this.logger.log(`Compiling workflow ${workflow.id} version ${version.version}`);
    const graph = WorkflowGraphSchema.parse(version.graph);
    const definition = compileWorkflowGraph(graph);
    await this.repository.saveCompiledDefinition(id, definition, { organizationId });
    await this.versionRepository.setCompiledDefinition(version.id, definition, {
      organizationId,
    });
    this.logger.log(
      `Compiled workflow ${workflow.id} version ${version.version} with ${definition.actions.length} action(s); entrypoint=${definition.entrypoint.ref}`,
    );
    return definition;
  }

  async run(
    id: string,
    request: WorkflowRunRequest = {},
    auth?: AuthContext | null,
    options: {
      trigger?: ExecutionTriggerMetadata;
      nodeOverrides?: Record<
        string,
        { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
      >;
      runId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<WorkflowRunHandle> {
    const prepared = await this.prepareRunPayload(id, request, auth, {
      trigger: options.trigger,
      nodeOverrides: options.nodeOverrides,
      runId: options.runId,
      idempotencyKey: options.idempotencyKey,
    });

    return this.startPreparedRun(prepared);
  }

  async startPreparedRun(prepared: PreparedRunPayload): Promise<WorkflowRunHandle> {
    const inputSummary = this.formatInputSummary(prepared.inputs);
    this.logger.log(
      `Starting workflow ${prepared.workflowId} (runId=${prepared.runId}, inputs=${inputSummary})`,
    );

    const existingRecord = await this.runRepository.findByRunId(prepared.runId, {
      organizationId: prepared.organizationId,
    });

    if (existingRecord?.temporalRunId) {
      this.logger.log(
        `Run ${prepared.runId} already started (temporalRunId=${existingRecord.temporalRunId})`,
      );
      return {
        runId: existingRecord.runId,
        workflowId: existingRecord.workflowId,
        workflowVersionId: existingRecord.workflowVersionId ?? prepared.workflowVersionId,
        workflowVersion: existingRecord.workflowVersion ?? prepared.workflowVersion,
        temporalRunId: existingRecord.temporalRunId,
        status: 'RUNNING',
        taskQueue: this.temporalService.getDefaultTaskQueue(),
      };
    }

    await this.repository.incrementRunCount(prepared.workflowId, {
      organizationId: prepared.organizationId,
    });

    let temporalRunId: string | null = null;
    try {
      const temporalRun = await this.temporalService.startWorkflow({
        workflowType: SHIPSEC_WORKFLOW_TYPE,
        workflowId: prepared.runId,
        args: [
          {
            runId: prepared.runId,
            workflowId: prepared.workflowId,
            definition: prepared.definition,
            inputs: prepared.inputs,
            workflowVersionId: prepared.workflowVersionId,
            workflowVersion: prepared.workflowVersion,
            organizationId: prepared.organizationId,
          },
        ],
      });
      temporalRunId = temporalRun.runId;

      this.logger.log(
        `Started workflow run ${prepared.runId} (workflowVersion=${prepared.workflowVersion}, temporalRunId=${temporalRun.runId}, taskQueue=${temporalRun.taskQueue}, actions=${prepared.totalActions})`,
      );

      await this.runRepository.upsert({
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        temporalRunId: temporalRun.runId,
        totalActions: prepared.totalActions,
        inputs: prepared.inputs,
        organizationId: prepared.organizationId,
        triggerType: prepared.triggerMetadata.type,
        triggerSource: prepared.triggerMetadata.sourceId,
        triggerLabel: prepared.triggerMetadata.label,
        inputPreview: prepared.inputPreview,
      });

      return {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        temporalRunId: temporalRun.runId,
        status: 'RUNNING',
        taskQueue: temporalRun.taskQueue,
      };
    } catch (error) {
      if (temporalRunId) {
        this.logger.warn(
          `Temporal workflow ${prepared.runId} reported error after start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as any).message === 'string' &&
        (error as any).message.includes('Workflow execution already started')
      ) {
        const existing = await this.runRepository.findByRunId(prepared.runId, {
          organizationId: prepared.organizationId,
        });
        if (existing?.temporalRunId) {
          this.logger.warn(
            `Workflow run ${prepared.runId} already active (temporalRunId=${existing.temporalRunId})`,
          );
          return {
            runId: existing.runId,
            workflowId: existing.workflowId,
            workflowVersionId: existing.workflowVersionId ?? prepared.workflowVersionId,
            workflowVersion: existing.workflowVersion ?? prepared.workflowVersion,
            temporalRunId: existing.temporalRunId,
            status: 'RUNNING',
            taskQueue: this.temporalService.getDefaultTaskQueue(),
          };
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to start workflow ${prepared.workflowId} run ${prepared.runId}: ${errorMessage}`,
      );

      if (errorStack) {
        this.logger.error(`Stack trace: ${errorStack}`);
      }

      this.logger.debug(
        `Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`,
      );

      throw error;
    }
  }

  async prepareRunPayload(
    id: string,
    request: WorkflowRunRequest = {},
    auth?: AuthContext | null,
    options: {
      trigger?: ExecutionTriggerMetadata;
      nodeOverrides?: Record<
        string,
        { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
      >;
      runId?: string;
      idempotencyKey?: string;
      parentRunId?: string;
      parentNodeRef?: string;
    } = {},
  ): Promise<PreparedRunPayload> {
    const organizationId = this.requireOrganizationId(auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    const version = await this.resolveWorkflowVersion(workflow.id, request, organizationId);
    const compiledDefinition = await this.ensureDefinitionForVersion(
      workflow,
      version,
      organizationId,
    );

    const nodeOverrides = options.nodeOverrides ?? {};
    let definitionWithOverrides = this.applyNodeOverrides(compiledDefinition, nodeOverrides);

    // Inject retry policies from component registry
    definitionWithOverrides = {
      ...definitionWithOverrides,
      actions: definitionWithOverrides.actions.map((action) => {
        const component = componentRegistry.get(action.componentId);
        if (component?.retryPolicy) {
          return {
            ...action,
            retryPolicy: component.retryPolicy,
          };
        }
        return action;
      }),
    };
    const normalizedKey = this.normalizeIdempotencyKey(options.idempotencyKey);
    const runId =
      options.runId ??
      (normalizedKey ? this.runIdFromIdempotencyKey(normalizedKey) : `shipsec-run-${randomUUID()}`);
    const triggerMetadata = options.trigger ?? this.buildEntryPointTriggerMetadata(auth);
    const inputs = request.inputs ?? {};
    const inputPreview = this.buildInputPreview(inputs, nodeOverrides);

    await this.runRepository.upsert({
      runId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      totalActions: definitionWithOverrides.actions.length,
      inputs,
      organizationId,
      triggerType: triggerMetadata.type,
      triggerSource: triggerMetadata.sourceId,
      triggerLabel: triggerMetadata.label,
      inputPreview,
      parentRunId: options.parentRunId,
      parentNodeRef: options.parentNodeRef,
    });

    this.analyticsService.trackWorkflowStarted({
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      runId,
      organizationId,
      nodeCount: compiledDefinition.actions.length,
      inputCount: Object.keys(request.inputs ?? {}).length,
      triggerType: triggerMetadata.type,
      triggerSource: triggerMetadata.sourceId ?? undefined,
      triggerLabel: triggerMetadata.label ?? undefined,
    });

    return {
      runId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      organizationId,
      definition: definitionWithOverrides,
      inputs,
      triggerMetadata,
      inputPreview,
      totalActions: definitionWithOverrides.actions.length,
    };
  }

  private async resolveWorkflowVersion(
    workflowId: string,
    request: WorkflowRunRequest,
    organizationId: string | null,
  ): Promise<WorkflowVersionRecord> {
    if (request.versionId) {
      const version = await this.versionRepository.findById(request.versionId, {
        organizationId: organizationId ?? undefined,
      });
      if (!version || version.workflowId !== workflowId) {
        throw new NotFoundException(
          `Workflow ${workflowId} version ${request.versionId} not found`,
        );
      }
      return version;
    }

    if (request.version) {
      const version = await this.versionRepository.findByWorkflowAndVersion({
        workflowId,
        version: request.version,
        organizationId,
      });
      if (!version) {
        throw new NotFoundException(`Workflow ${workflowId} version ${request.version} not found`);
      }
      return version;
    }

    const latest = await this.versionRepository.findLatestByWorkflowId(workflowId, {
      organizationId: organizationId ?? undefined,
    });
    if (!latest) {
      throw new NotFoundException(`No versions recorded for workflow ${workflowId}`);
    }
    return latest;
  }

  private async ensureDefinitionForVersion(
    workflow: WorkflowRecord,
    version: WorkflowVersionRecord,
    organizationId: string | null,
  ): Promise<WorkflowDefinition> {
    if (version.compiledDefinition) {
      const definition = version.compiledDefinition as WorkflowDefinition;
      const entryAction = definition.actions.find(
        (action) => action.componentId === 'core.workflow.entrypoint',
      );

      if (
        entryAction &&
        (!definition.entrypoint || definition.entrypoint.ref !== entryAction.ref)
      ) {
        const patchedDefinition: WorkflowDefinition = {
          ...definition,
          entrypoint: { ref: entryAction.ref },
        };

        await this.versionRepository.setCompiledDefinition(version.id, patchedDefinition, {
          organizationId: organizationId ?? undefined,
        });

        return patchedDefinition;
      }

      return definition;
    }

    this.logger.log(`Compiling workflow ${workflow.id} version ${version.version} for execution`);
    const graph = WorkflowGraphSchema.parse(version.graph);
    const definition = compileWorkflowGraph(graph);

    await this.versionRepository.setCompiledDefinition(version.id, definition, {
      organizationId: organizationId ?? undefined,
    });

    return definition;
  }

  async getRunStatus(
    runId: string,
    temporalRunId?: string,
    auth?: AuthContext | null,
  ): Promise<WorkflowRunStatusPayload> {
    this.logger.log(
      `Fetching status for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    const { organizationId, run } = await this.requireRunAccess(runId, auth);

    let temporalStatus: Awaited<ReturnType<typeof this.temporalService.describeWorkflow>>;
    let completedActions = 0;
    let failedActions = 0;
    let startedActions = 0;
    let statusPayload: WorkflowRunStatusPayload;

    // Cache HIT — skip Temporal entirely for terminal runs
    if (run.status && (TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      // Still need completed actions for progress
      if (run.totalActions && run.totalActions > 0) {
        completedActions = await this.traceRepository.countByType(
          runId,
          'NODE_COMPLETED',
          organizationId,
        );
      }

      statusPayload = {
        runId,
        workflowId: run.workflowId,
        status: run.status as ExecutionStatus,
        startedAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt ? new Date(run.updatedAt).toISOString() : new Date().toISOString(),
        completedAt: run.closeTime?.toISOString() ?? undefined,
        taskQueue: '',
        historyLength: 0,
        progress:
          run.totalActions && run.totalActions > 0
            ? {
                completedActions: Math.min(completedActions, run.totalActions),
                totalActions: run.totalActions,
              }
            : undefined,
      };
    } else {
      // Cache MISS — query Temporal
      // Pre-fetch trace event counts for status inference
      if (run.totalActions && run.totalActions > 0) {
        [completedActions, failedActions, startedActions] = await Promise.all([
          this.traceRepository.countByType(runId, 'NODE_COMPLETED', organizationId),
          this.traceRepository.countByType(runId, 'NODE_FAILED', organizationId),
          this.traceRepository.countByType(runId, 'NODE_STARTED', organizationId),
        ]);
      }

      try {
        temporalStatus = await this.temporalService.describeWorkflow({
          workflowId: runId,
          runId: temporalRunId,
        });

        // Cache terminal statuses (fire-and-forget)
        const normalizedStatus = this.normalizeStatus(temporalStatus.status);
        if ((TERMINAL_STATUSES as readonly string[]).includes(normalizedStatus)) {
          this.runRepository
            .cacheTerminalStatus(
              run.runId,
              normalizedStatus,
              temporalStatus.closeTime ? new Date(temporalStatus.closeTime) : undefined,
            )
            .catch((err) => this.logger.warn(`Failed to cache status for ${run.runId}: ${err}`));
        }
      } catch (error) {
        // If Temporal can't find the workflow, infer status from trace events
        if (this.isNotFoundError(error)) {
          const inferredStatus = this.inferStatusFromTraceEvents({
            runId,
            totalActions: run.totalActions ?? 0,
            completedActions,
            failedActions,
            startedActions,
          });

          this.logger.log(
            `Workflow ${runId} not found in Temporal, inferred status: ${inferredStatus} ` +
              `(started=${startedActions}, completed=${completedActions}, failed=${failedActions}, total=${run.totalActions})`,
          );

          temporalStatus = {
            workflowId: runId,
            runId: temporalRunId ?? runId,
            // Cast to WorkflowExecutionStatusName - normalizeStatus handles mapping
            status: inferredStatus as unknown as typeof temporalStatus.status,
            startTime: run.createdAt.toISOString(),
            // Only set closeTime for terminal states that actually ran
            closeTime: ['COMPLETED', 'FAILED'].includes(inferredStatus)
              ? new Date().toISOString()
              : undefined,
            historyLength: 0,
            taskQueue: '',
          };
        } else {
          throw error;
        }
      }

      statusPayload = this.mapTemporalStatus(runId, temporalStatus, run, completedActions);

      // Override running status if waiting for human input
      if (statusPayload.status === 'RUNNING') {
        const hasPendingInput = await this.runRepository.hasPendingInputs(runId);
        if (hasPendingInput) {
          statusPayload.status = 'AWAITING_INPUT';
        }
      }
    }

    // Track workflow completion/failure when status changes to terminal state
    if ((TERMINAL_STATUSES as readonly string[]).includes(statusPayload.status)) {
      const startTime = run.createdAt;
      const endTime = statusPayload.completedAt ? new Date(statusPayload.completedAt) : new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      this.analyticsService.trackWorkflowCompleted({
        workflowId: run.workflowId,
        runId,
        organizationId,
        durationMs,
        nodeCount: run.totalActions ?? 0,
        success: statusPayload.status === 'COMPLETED',
        failureReason: statusPayload.failure?.reason,
      });
    }

    return statusPayload;
  }

  async getRunResult(runId: string, temporalRunId?: string, auth?: AuthContext | null) {
    this.logger.log(
      `Fetching result for workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    await this.requireRunAccess(runId, auth);
    return this.temporalService.getWorkflowResult({ workflowId: runId, runId: temporalRunId });
  }

  async getRunConfig(runId: string, auth?: AuthContext | null): Promise<WorkflowRunConfigPayload> {
    const { run } = await this.requireRunAccess(runId, auth);
    return {
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      inputs: run.inputs ?? {},
    };
  }

  async getWorkflowVersion(workflowId: string, versionId: string, auth?: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const version = await this.versionRepository.findById(versionId, { organizationId });
    if (!version || version.workflowId !== workflowId) {
      throw new NotFoundException(
        `Workflow version ${versionId} not found for workflow ${workflowId}`,
      );
    }

    return {
      id: version.id,
      workflowId: version.workflowId,
      version: version.version,
      graph: version.graph,
      createdAt:
        version.createdAt instanceof Date ? version.createdAt.toISOString() : version.createdAt,
    };
  }

  async cancelRun(runId: string, temporalRunId?: string, auth?: AuthContext | null): Promise<void> {
    this.logger.warn(
      `Cancelling workflow run ${runId} (temporalRunId=${temporalRunId ?? 'latest'})`,
    );
    await this.requireRunAccess(runId, auth);
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

    const organizationId = run.organizationId ?? null;

    const workflow = await this.repository.findById(run.workflowId, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${run.workflowId} not found for run ${runId}`);
    }

    const version = run.workflowVersionId
      ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
      : await this.versionRepository.findLatestByWorkflowId(run.workflowId, {
          organizationId,
        });
    if (!version) {
      throw new NotFoundException(
        `Workflow version not found for run ${runId} (workflow=${run.workflowId})`,
      );
    }

    const definition = await this.ensureDefinitionForVersion(workflow, version, organizationId);
    const targetsBySource = this.buildTargetsIndex(definition);

    const context: FlowContext = {
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersion: version.version,
      definition,
      targetsBySource,
    };

    this.flowContexts.set(runId, context);
    return context;
  }

  private buildTargetsIndex(definition: WorkflowDefinition): FlowContext['targetsBySource'] {
    const map = new Map<string, { targetRef: string; sourceHandle: string; inputKey: string }[]>();

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

  private parse(dto: WorkflowGraphDto): WorkflowGraph {
    const parsed = WorkflowGraphSchema.parse(dto);

    // Resolve dynamic ports for all nodes using the shared helper
    return this.resolveGraphPorts(parsed);
  }

  private formatInputSummary(inputs?: Record<string, unknown>): string {
    if (!inputs || Object.keys(inputs).length === 0) {
      return 'none';
    }

    return Object.entries(inputs)
      .map(([key, value]) => `${key}=${this.describeValue(value)}`)
      .join(', ');
  }

  private applyNodeOverrides(
    definition: WorkflowDefinition,
    overrides?: Record<
      string,
      { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
    >,
  ): WorkflowDefinition {
    if (!overrides || Object.keys(overrides).length === 0) {
      return definition;
    }

    const updatedActions = definition.actions.map((action) => {
      const override = overrides[action.ref];
      if (
        !override ||
        (Object.keys(override.params ?? {}).length === 0 &&
          Object.keys(override.inputOverrides ?? {}).length === 0)
      ) {
        return action;
      }

      return {
        ...action,
        params: {
          ...(action.params ?? {}),
          ...(override.params ?? {}),
        },
        inputOverrides: {
          ...(action.inputOverrides ?? {}),
          ...(override.inputOverrides ?? {}),
        },
      };
    });

    return {
      ...definition,
      actions: updatedActions,
    };
  }

  private buildEntryPointTriggerMetadata(auth?: AuthContext | null): {
    type: ExecutionTriggerType;
    sourceId: string | null;
    label: string;
  } {
    const sourceId = auth?.userId ?? null;
    const label = sourceId ? `Manual run by ${sourceId}` : 'Manual run';
    return {
      type: 'manual',
      sourceId,
      label,
    };
  }

  private buildInputPreview(
    inputs?: Record<string, unknown>,
    nodeOverrides?: Record<
      string,
      { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
    >,
  ): ExecutionInputPreview {
    const runtimeInputs = inputs ? { ...inputs } : {};
    const overrides: Record<
      string,
      { params: Record<string, unknown>; inputOverrides: Record<string, unknown> }
    > = {};

    if (nodeOverrides) {
      for (const [key, value] of Object.entries(nodeOverrides)) {
        overrides[key] = {
          params: value.params ?? {},
          inputOverrides: value.inputOverrides ?? {},
        };
      }
    }

    return {
      runtimeInputs,
      nodeOverrides: overrides,
    };
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
    const progress =
      totalActions > 0
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

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    // Check for Temporal WorkflowNotFoundError
    if (error instanceof WorkflowNotFoundError) {
      return true;
    }

    // Check for gRPC NOT_FOUND error
    const serviceError = error as ServiceError;
    return serviceError.code === grpcStatus.NOT_FOUND;
  }

  /**
   * Infer workflow status from trace events when Temporal workflow is not found.
   *
   * Cases:
   * - No started events → STALE (orphaned record - run exists but never executed)
   * - All nodes completed → COMPLETED
   * - Any node failed → FAILED
   * - Partial completion (some started, not all finished) → FAILED (crashed/lost)
   */
  private inferStatusFromTraceEvents(params: {
    runId: string;
    totalActions: number;
    completedActions: number;
    failedActions: number;
    startedActions: number;
  }): ExecutionStatus {
    const { totalActions, completedActions, failedActions, startedActions } = params;

    // Case 1: No events at all - orphaned record (DB/Temporal mismatch)
    // This indicates data inconsistency - run record exists but workflow never executed
    if (startedActions === 0) {
      return 'STALE';
    }

    // Case 2: Any node failed explicitly
    if (failedActions > 0) {
      return 'FAILED';
    }

    // Case 3: All nodes completed successfully
    if (totalActions > 0 && completedActions >= totalActions) {
      return 'COMPLETED';
    }

    // Case 4: Some nodes started but not all completed and no failures
    // This means the workflow crashed or was lost - treat as FAILED
    if (startedActions > 0 && completedActions < totalActions) {
      return 'FAILED';
    }

    // Fallback: we have events but can't determine status
    // This shouldn't happen normally, but default to FAILED for safety
    return 'FAILED';
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
