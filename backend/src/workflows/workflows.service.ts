import { randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';

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
} from './dto/workflow-graph.dto';
import {
  WorkflowRecord,
  WorkflowRepository,
} from './repository/workflow.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { TraceRepository } from '../trace/trace.repository';
import {
  ExecutionStatus,
  FailureSummary,
  WorkflowRunStatusPayload,
  TraceEventPayload,
  WorkflowRunConfigPayload,
} from '@shipsec/shared';
import type { WorkflowVersionRecord } from '../database/schema';
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
  ) {}

  private resolveOrganizationId(auth?: AuthContext | null): string | null {
    return auth?.organizationId ?? null;
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
    const enrichedRuns = [];

    for (const run of runs) {
      // Get workflow name
      const workflow = await this.repository.findById(run.workflowId, { organizationId });
      const workflowName = workflow?.name ?? 'Unknown Workflow';
      const version = run.workflowVersionId
        ? await this.versionRepository.findById(run.workflowVersionId, { organizationId })
        : workflow
          ? await this.versionRepository.findLatestByWorkflowId(workflow.id, { organizationId })
          : undefined;
      const graph = (version?.graph ?? workflow?.graph) as { nodes?: unknown[] } | undefined;
      const nodeCount = Array.isArray(graph?.nodes) ? graph!.nodes!.length : 0;

      // Get event count
      const eventCount = await this.traceRepository.countByType(
        run.runId,
        'NODE_STARTED',
        organizationId,
      );

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
        workflowVersionId: run.workflowVersionId ?? null,
        workflowVersion: run.workflowVersion ?? null,
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
  ): Promise<WorkflowRunHandle> {
    const organizationId = this.requireOrganizationId(auth);
    const workflow = await this.repository.findById(id, { organizationId });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    const inputSummary = this.formatInputSummary(request.inputs);
    this.logger.log(
      `Received run request for workflow ${workflow.id} (inputs=${inputSummary})`,
    );

    const version = await this.resolveWorkflowVersion(workflow.id, request, organizationId);
    const compiledDefinition = await this.ensureDefinitionForVersion(
      workflow,
      version,
      organizationId,
    );
    const runId = `shipsec-run-${randomUUID()}`;

    // Track execution stats
    await this.repository.incrementRunCount(id, { organizationId });

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
            workflowVersionId: version.id,
            workflowVersion: version.version,
            organizationId,
          },
        ],
      });

      this.logger.log(
        `Started workflow run ${runId} (workflowVersion=${version.version}, temporalRunId=${temporalRun.runId}, taskQueue=${temporalRun.taskQueue}, actions=${compiledDefinition.actions.length})`,
      );

      await this.runRepository.upsert({
        runId,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        temporalRunId: temporalRun.runId,
        totalActions: compiledDefinition.actions.length,
        inputs: request.inputs ?? {},
        organizationId,
      });

      return {
        runId,
        workflowId: workflow.id,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        temporalRunId: temporalRun.runId,
        status: 'RUNNING',
        taskQueue: temporalRun.taskQueue,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to start workflow ${workflow.id} run ${runId}: ${errorMessage}`,
      );

      if (errorStack) {
        this.logger.error(`Stack trace: ${errorStack}`);
      }

      // Log the full error object for debugging
      this.logger.debug(`Full error object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);

      throw error;
    }
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
      return version.compiledDefinition as WorkflowDefinition;
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

    return this.mapTemporalStatus(runId, temporalStatus, run, completedActions);
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
