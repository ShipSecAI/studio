import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { status as grpcStatus, type ServiceError } from '@grpc/grpc-js';
import Long from 'long';
import {
  Connection,
  ScheduleClient,
  ScheduleDescription,
  ScheduleOverlapPolicy as TemporalScheduleOverlapPolicy,
  WorkflowClient,
  type WorkflowExecutionStatusName,
  type WorkflowHandle,
} from '@temporalio/client';

// Import workflow functions (for type safety during client.start())
// Note: Actual implementation runs in the worker
import { shipsecWorkflowRun, testMinimalWorkflow, scheduleTriggerWorkflow } from '@shipsec/studio-worker/workflows';
import type { ExecutionTriggerMetadata, ScheduleOverlapPolicy } from '@shipsec/shared';

export interface StartWorkflowOptions {
  workflowType: string;
  workflowId?: string;
  taskQueue?: string;
  args?: unknown[];
  memo?: Record<string, unknown>;
  searchAttributes?: Record<string, unknown>;
}

export interface WorkflowRunReference {
  workflowId: string;
  runId?: string;
}

export interface WorkflowStartResult {
  workflowId: string;
  runId: string;
  taskQueue: string;
}

export interface WorkflowRunStatus {
  workflowId: string;
  runId: string;
  status: WorkflowExecutionStatusName;
  startTime: string;
  closeTime?: string;
  historyLength: number;
  taskQueue: string;
  failure?: unknown;
}

export interface CreateTemporalScheduleInput {
  scheduleId: string;
  organizationId: string | null;
  cronExpression: string;
  timezone: string;
  overlapPolicy: ScheduleOverlapPolicy;
  catchupWindowSeconds?: number;
  memo?: Record<string, unknown>;
  dispatchArgs: ScheduleTriggerWorkflowArgs;
}

export interface UpdateTemporalScheduleInput extends CreateTemporalScheduleInput {}

export interface ScheduleTriggerWorkflowArgs {
  workflowId: string;
  workflowVersionId?: string | null;
  workflowVersion?: number | null;
  organizationId?: string | null;
  scheduleId?: string;
  scheduleName?: string | null;
  runtimeInputs?: Record<string, unknown>;
  nodeOverrides?: Record<string, Record<string, unknown>>;
  trigger?: ExecutionTriggerMetadata;
}

@Injectable()
export class TemporalService implements OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private readonly address: string;
  private readonly namespace: string;
  private readonly defaultTaskQueue: string;
  private clientPromise?: Promise<WorkflowClient>;
  private scheduleClientPromise?: Promise<ScheduleClient>;
  private connection?: Connection;

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.address = this.configService.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    this.namespace = this.configService.get<string>('TEMPORAL_NAMESPACE', 'shipsec-dev');
    this.defaultTaskQueue = this.configService.get<string>(
      'TEMPORAL_TASK_QUEUE',
      'shipsec-default',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = undefined;
      this.clientPromise = undefined;
    }
  }

  async startWorkflow(options: StartWorkflowOptions): Promise<WorkflowStartResult> {
    const client = await this.getClient();
    const workflowId = options.workflowId ?? `shipsec-workflow-${randomUUID()}`;
    const taskQueue = options.taskQueue ?? this.defaultTaskQueue;

    const argsSummary = this.formatArgsSummary(options.args);
    this.logger.log(
      `Starting Temporal workflow ${options.workflowType} (workflowId=${workflowId}, taskQueue=${taskQueue}, args=${argsSummary})`,
    );

    // Map workflow type string to function reference
    const workflowFn = this.getWorkflowFunction(options.workflowType);

    const handle = await client.start(workflowFn, {
      workflowId,
      taskQueue,
      args: (options.args ?? []) as any,
      memo: options.memo,
      searchAttributes: options.searchAttributes as any,
    });

    this.logger.log(
      `Started Temporal workflow ${handle.workflowId} (run ${handle.firstExecutionRunId})`,
    );

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      taskQueue,
    };
  }

  private getWorkflowFunction(workflowType: string) {
    switch (workflowType) {
      case 'shipsecWorkflowRun':
        return shipsecWorkflowRun;
      case 'testMinimalWorkflow':
        return testMinimalWorkflow;
      case 'scheduleTriggerWorkflow':
        return scheduleTriggerWorkflow;
      default:
        throw new Error(`Unknown workflow type: ${workflowType}`);
    }
  }

  async describeWorkflow(ref: WorkflowRunReference): Promise<WorkflowRunStatus> {
    const handle = await this.getWorkflowHandle(ref);
    this.logger.log(
      `Describing workflow ${handle.workflowId} (runId=${ref.runId ?? 'latest'})`,
    );
    const description = await handle.describe();
    return {
      workflowId: description.workflowId,
      runId: description.runId,
      status: description.status.name,
      startTime: description.startTime.toISOString(),
      closeTime: description.closeTime?.toISOString(),
      historyLength: description.historyLength,
      taskQueue: description.taskQueue,
      failure: (description.status as any)?.failure,
    };
  }

  async getWorkflowResult(ref: WorkflowRunReference) {
    const handle = await this.getWorkflowHandle(ref);
    this.logger.log(
      `Retrieving workflow result for ${handle.workflowId} (runId=${ref.runId ?? 'latest'})`,
    );
    return handle.result();
  }

  async cancelWorkflow(ref: WorkflowRunReference): Promise<void> {
    const handle = await this.getWorkflowHandle(ref);
    this.logger.warn(
      `Terminating workflow ${handle.workflowId} (runId=${ref.runId ?? 'latest'})`,
    );
    // Use terminate() for immediate stop - shows as TERMINATED status
    // cancel() requires workflow cooperation and may show as FAILED if not handled
    await handle.terminate('User requested stop');
  }

  /**
   * Send a signal to a running workflow
   */
  async signalWorkflow(input: {
    workflowId: string;
    signalName: string;
    args: any;
  }): Promise<void> {
    const handle = await this.getWorkflowHandle({ workflowId: input.workflowId });
    this.logger.log(
      `Sending signal ${input.signalName} to workflow ${input.workflowId} with args: ${JSON.stringify(input.args)}`,
    );
    await handle.signal(input.signalName, input.args);
  }

  private async getWorkflowHandle(ref: WorkflowRunReference): Promise<WorkflowHandle<any>> {
    const client = await this.getClient();
    return client.getHandle(ref.workflowId, ref.runId);
  }

  getDefaultTaskQueue(): string {
    return this.defaultTaskQueue;
  }

  private async getClient(): Promise<WorkflowClient> {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    this.clientPromise = (async () => {
      try {
        this.logger.log(
          `Connecting to Temporal at ${this.address} (namespace=${this.namespace})`,
        );
        const connection = await Connection.connect({ address: this.address });
        await this.ensureNamespace(connection);
        this.connection = connection;
        const client = new WorkflowClient({
          connection,
          namespace: this.namespace,
        });
        this.logger.log(
          `Temporal client ready (namespace=${this.namespace}, defaultTaskQueue=${this.defaultTaskQueue})`,
        );
        return client;
      } catch (error) {
        this.clientPromise = undefined;
        this.logger.error(
          `Failed to connect to Temporal: ${error instanceof Error ? error.message : String(
            error,
          )}`,
        );
        throw error;
      }
    })();

    return this.clientPromise;
  }

  private async ensureNamespace(connection: Connection): Promise<void> {
    try {
      await connection.workflowService.describeNamespace({
        namespace: this.namespace,
      });
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        this.logger.error(
          `Failed to describe Temporal namespace ${this.namespace}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }

      this.logger.log(`Registering Temporal namespace ${this.namespace}`);
      await connection.workflowService.registerNamespace({
        namespace: this.namespace,
        workflowExecutionRetentionPeriod: { seconds: Long.fromNumber(60 * 60 * 24 * 7) },
      });
    }
  }

  private isNotFoundError(error: unknown): error is ServiceError {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const serviceError = error as ServiceError;
    return serviceError.code === grpcStatus.NOT_FOUND;
  }

  private formatArgsSummary(args?: unknown[]): string {
    if (!args || args.length === 0) {
      return 'none';
    }

    return args
      .map((arg) => {
        if (arg && typeof arg === 'object') {
          const payload = arg as Record<string, unknown>;
          const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
          const workflowId = typeof payload.workflowId === 'string' ? payload.workflowId : undefined;
          const definition = payload.definition as { actions?: unknown[] } | undefined;
          const actionCount =
            definition && Array.isArray(definition.actions) ? definition.actions.length : undefined;

          const summaries = [];
          if (workflowId) summaries.push(`workflowId=${workflowId}`);
          if (runId) summaries.push(`runId=${runId}`);
          if (actionCount !== undefined) summaries.push(`actions=${actionCount}`);
          if (payload.inputs && typeof payload.inputs === 'object') {
            const inputKeys = Object.keys(payload.inputs as Record<string, unknown>);
            summaries.push(`inputs=[${inputKeys.join(', ')}]`);
          }

          return summaries.length > 0 ? summaries.join(', ') : 'object';
        }

        if (Array.isArray(arg)) {
          return `array(len=${arg.length})`;
        }

        return String(arg);
      })
      .join(' | ');
  }
  private async getScheduleClient(): Promise<ScheduleClient> {
    if (this.scheduleClientPromise) {
      return this.scheduleClientPromise;
    }

    this.scheduleClientPromise = (async () => {
      await this.getClient();
      if (!this.connection) {
        throw new Error('Temporal connection not established');
      }
      return new ScheduleClient({
        connection: this.connection,
        namespace: this.namespace,
      });
    })();

    return this.scheduleClientPromise;
  }

  async createSchedule(options: CreateTemporalScheduleInput): Promise<void> {
    const client = await this.getScheduleClient();
    await client.create({
      scheduleId: options.scheduleId,
      memo: options.memo,
      spec: {
        cronExpressions: [options.cronExpression],
        timezone: options.timezone,
      },
      action: {
        type: 'startWorkflow',
        workflowType: 'scheduleTriggerWorkflow',
        taskQueue: this.defaultTaskQueue,
        args: [options.dispatchArgs],
        workflowId: `schedule-${options.scheduleId}`,
      },
      policies: {
        overlap: this.mapOverlapPolicy(options.overlapPolicy),
        catchupWindow: options.catchupWindowSeconds
          ? options.catchupWindowSeconds * 1000
          : undefined,
      },
    });
  }

  async updateSchedule(options: UpdateTemporalScheduleInput): Promise<void> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(options.scheduleId);
    await handle.update((previous) => ({
      spec: {
        cronExpressions: [options.cronExpression],
        timezone: options.timezone,
      },
      memo: options.memo,
      action: {
        type: 'startWorkflow',
        workflowType: 'scheduleTriggerWorkflow',
        taskQueue: this.defaultTaskQueue,
        args: [options.dispatchArgs],
        workflowId: `schedule-${options.scheduleId}`,
      },
      policies: {
        overlap: this.mapOverlapPolicy(options.overlapPolicy),
        catchupWindow: options.catchupWindowSeconds
          ? options.catchupWindowSeconds * 1000
          : undefined,
      },
      state: {
        paused: previous.state.paused,
        note: previous.state.note,
        remainingActions: previous.state.remainingActions,
      },
    }));
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(scheduleId);
    await handle.delete();
  }

  async pauseSchedule(scheduleId: string, note = 'Paused via API'): Promise<void> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(scheduleId);
    await handle.pause(note);
  }

  async resumeSchedule(scheduleId: string, note = 'Resumed via API'): Promise<void> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(scheduleId);
    await handle.unpause(note);
  }

  async triggerSchedule(scheduleId: string): Promise<void> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(scheduleId);
    await handle.trigger();
  }

  async describeSchedule(scheduleId: string): Promise<ScheduleDescription> {
    const client = await this.getScheduleClient();
    const handle = client.getHandle(scheduleId);
    return handle.describe();
  }

  private mapOverlapPolicy(policy: ScheduleOverlapPolicy): TemporalScheduleOverlapPolicy {
    switch (policy) {
      case 'allow':
        return TemporalScheduleOverlapPolicy.ALLOW_ALL;
      case 'buffer':
        return TemporalScheduleOverlapPolicy.BUFFER_ONE;
      case 'skip':
      default:
        return TemporalScheduleOverlapPolicy.SKIP;
    }
  }

}
