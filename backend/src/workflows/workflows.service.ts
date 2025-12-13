import { randomUUID, createHash } from 'node:crypto';

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { status as grpcStatus, type ServiceError } from '@grpc/grpc-js';

import { compileWorkflowGraph } from '../dsl/compiler';
import { WorkflowDefinition } from '../dsl/types';
import {
  TemporalService,
  type WorkflowRunStatus as TemporalWorkflowRunStatus,
} from '../temporal/temporal.service';
import {
  WorkflowGraphDto,
  WorkflowGraphSchema,
  ServiceWorkflowResponse,
  UpdateWorkflowMetadataDto,
} from './dto/workflow-graph.dto';
import {
  WorkflowRecord,
  WorkflowRepository,
} from './repository/workflow.repository';
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
} from '@shipsec/shared';
import type { WorkflowRunRecord, WorkflowVersionRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';

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

  async ensureWorkflowAdminAccess(
    workflowId: string,
    auth?: AuthContext | null,
  ): Promise<string> {
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
      throw new NotFoundException(`Workflow ${workflowId} not found`);
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
      `[WORKFLOWS] Checking org admin - Auth: ${auth ? 'present' : 'null'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}, User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}`
    );
    if (!auth?.roles || !auth.roles.includes('ADMIN')) {
      this.logger.warn(
        `[WORKFLOWS] Access denied - User: ${auth?.userId || 'none'}, Org: ${auth?.organizationId || 'none'}, Roles: ${auth?.roles ? JSON.stringify(auth.roles) : 'none'}`
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

  private async requireRunAccess(
    runId: string,
    auth?: AuthContext | null,
  ) {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.runRepository.findByRunId(runId, { organizationId });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    return { organizationId, run };
  }

  async resolveRunForAccess(
    runId: string,
    auth?: AuthContext | null,
  ) {
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

  async ensureRunAccess(
    runId: string,
    auth?: AuthContext | null,
  ): Promise<void> {
    await this.requireRunAccess(runId, auth);
  }

  async create(
    dto: WorkflowGraphDto,
    auth?: AuthContext | null,
  ): Promise<ServiceWorkflowResponse> {
    const input = this.parse(dto);
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
    return {
      ...record,
      currentVersionId: version?.id ?? null,
      currentVersion: version?.version ?? null,
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
    const nodeCount = Array.isArray(graph?.nodes) ? graph!.nodes!.length : 0;

    const eventCount = await this.traceRepository.countByType(
      run.runId,
      'NODE_STARTED',
      organizationId,
    );

    // Calculate duration from events (more accurate than createdAt/updatedAt)
    const eventTimeRange = await this.traceRepository.getEventTimeRange(
      run.runId,
      organizationId,
    );
    const duration = eventTimeRange.firstTimestamp && eventTimeRange.lastTimestamp
      ? this.computeDuration(eventTimeRange.firstTimestamp, eventTimeRange.lastTimestamp)
      : this.computeDuration(run.createdAt, run.updatedAt);

    let currentStatus: ExecutionStatus = 'RUNNING';
    try {
      const status = await this.temporalService.describeWorkflow({
        workflowId: run.runId,
        runId: run.temporalRunId ?? undefined,
      });
      currentStatus = this.normalizeStatus(status.status);
    } catch (error) {
      // If Temporal can't find the workflow (NOT_FOUND), check if events have stopped
      // If events stopped more than 5 minutes ago, assume the workflow completed
      const isNotFound = this.isNotFoundError(error);
      if (isNotFound && eventTimeRange.lastTimestamp) {
        const lastEventTime = new Date(eventTimeRange.lastTimestamp);
        const minutesSinceLastEvent = (Date.now() - lastEventTime.getTime()) / (1000 * 60);
        if (minutesSinceLastEvent > 5) {
          // Events stopped more than 5 minutes ago and Temporal can't find it
          // Assume the workflow completed successfully
          currentStatus = 'COMPLETED';
          this.logger.log(
            `Run ${run.runId} not found in Temporal but last event was ${minutesSinceLastEvent.toFixed(1)} minutes ago, assuming COMPLETED`,
          );
        } else {
          this.logger.warn(`Failed to get status for run ${run.runId}: ${error}`);
        }
      } else {
        this.logger.warn(`Failed to get status for run ${run.runId}: ${error}`);
      }
    }

    const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual';
    const triggerSource = run.triggerSource ?? null;
    const triggerLabel = run.triggerLabel ?? (triggerType === 'manual' ? 'Manual run' : null);
    const inputPreview: ExecutionInputPreview =
      run.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} };

    return {
      id: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      status: currentStatus,
      startTime: run.createdAt,
      endTime: run.updatedAt ?? null,
      temporalRunId: run.temporalRunId ?? undefined,
      workflowName,
      eventCount,
      nodeCount,
      duration,
      triggerType,
      triggerSource,
      triggerLabel,
      inputPreview,
    };
  }

  async listRuns(
    auth?: AuthContext | null,
    options: {
      workflowId?: string;
      status?: ExecutionStatus;
      limit?: number;
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
      nodeOverrides?: Record<string, Record<string, unknown>>;
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

      this.logger.debug(`Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);

      throw error;
    }
  }

  async prepareRunPayload(
    id: string,
    request: WorkflowRunRequest = {},
    auth?: AuthContext | null,
    options: {
      trigger?: ExecutionTriggerMetadata;
      nodeOverrides?: Record<string, Record<string, unknown>>;
      runId?: string;
      idempotencyKey?: string;
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
    const definitionWithOverrides = this.applyNodeOverrides(compiledDefinition, nodeOverrides);
    const normalizedKey = this.normalizeIdempotencyKey(options.idempotencyKey);
    const runId = options.runId ?? (normalizedKey ? this.runIdFromIdempotencyKey(normalizedKey) : `shipsec-run-${randomUUID()}`);
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
        triggerLabel: triggerMetadata.label ?? undefined
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
        throw new NotFoundException(
          `Workflow ${workflowId} version ${request.version} not found`,
        );
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

        await this.versionRepository.setCompiledDefinition(
          version.id,
          patchedDefinition,
          {
            organizationId: organizationId ?? undefined,
          },
        );

        return patchedDefinition;
      }

      return definition;
    }

    this.logger.log(
      `Compiling workflow ${workflow.id} version ${version.version} for execution`,
    );
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
    const temporalStatus = await this.temporalService.describeWorkflow({
      workflowId: runId,
      runId: temporalRunId,
    });
    const { organizationId, run } = await this.requireRunAccess(runId, auth);

    let completedActions = 0;
    if (run.totalActions && run.totalActions > 0) {
      completedActions = await this.traceRepository.countByType(
        runId,
        'NODE_COMPLETED',
        organizationId,
      );
    }

    const statusPayload = this.mapTemporalStatus(runId, temporalStatus, run, completedActions);

    // Track workflow completion/failure when status changes to terminal state
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'].includes(statusPayload.status)) {
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

  async getRunConfig(
    runId: string,
    auth?: AuthContext | null,
  ): Promise<WorkflowRunConfigPayload> {
    const { run } = await this.requireRunAccess(runId, auth);
    return {
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId ?? null,
      workflowVersion: run.workflowVersion ?? null,
      inputs: run.inputs ?? {},
    };
  }

  async getWorkflowVersion(
    workflowId: string,
    versionId: string,
    auth?: AuthContext | null,
  ) {
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

  private applyNodeOverrides(
    definition: WorkflowDefinition,
    overrides?: Record<string, Record<string, unknown>>,
  ): WorkflowDefinition {
    if (!overrides || Object.keys(overrides).length === 0) {
      return definition;
    }

    const updatedActions = definition.actions.map((action) => {
      const override = overrides[action.ref];
      if (!override || Object.keys(override).length === 0) {
        return action;
      }

      return {
        ...action,
        params: {
          ...(action.params ?? {}),
          ...override,
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
    nodeOverrides?: Record<string, Record<string, unknown>>,
  ): ExecutionInputPreview {
    const runtimeInputs = inputs ? { ...inputs } : {};
    const overrides = nodeOverrides ? { ...nodeOverrides } : {};
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

  private isNotFoundError(error: unknown): error is ServiceError {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const serviceError = error as ServiceError;
    return serviceError.code === grpcStatus.NOT_FOUND;
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
