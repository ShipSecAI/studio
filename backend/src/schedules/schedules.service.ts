import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  type ScheduleInputPayload,
  type WorkflowSchedule,
  ScheduleOverlapPolicy,
} from '@shipsec/shared';
import type { WorkflowDefinition } from '../dsl/types';
import type { AuthContext } from '../auth/types';
import { WorkflowsService } from '../workflows/workflows.service';
import { ScheduleRepository } from './repository/schedule.repository';
import type { WorkflowScheduleRecord } from '../database/schema';
import { TemporalService, type ScheduleTriggerWorkflowArgs } from '../temporal/temporal.service';
import { CreateScheduleRequestDto, UpdateScheduleRequestDto } from './dto/schedule.dto';
import type { ScheduleRepositoryFilters } from './repository/schedule.repository';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private readonly repository: ScheduleRepository,
    private readonly workflowsService: WorkflowsService,
    private readonly temporalService: TemporalService,
  ) {}

  async list(auth: AuthContext | null, filters: ScheduleRepositoryFilters = {}) {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.list({
      ...filters,
      organizationId,
    });
    return records.map((record) => this.mapRecord(record));
  }

  async get(auth: AuthContext | null, id: string): Promise<WorkflowSchedule> {
    const record = await this.findOwnedScheduleOrThrow(id, auth);
    return this.mapRecord(record);
  }

  async create(auth: AuthContext | null, dto: CreateScheduleRequestDto): Promise<WorkflowSchedule> {
    await this.workflowsService.ensureWorkflowAdminAccess(dto.workflowId, auth);
    const context = await this.workflowsService.getCompiledWorkflowContext(
      dto.workflowId,
      { versionId: dto.workflowVersionId },
      auth,
    );

    const normalizedPayload: ScheduleInputPayload =
      dto.inputPayload ?? { runtimeInputs: {}, nodeOverrides: {} };

    this.validateSchedulePayload(context.definition, normalizedPayload);

    const record = await this.repository.create({
      workflowId: context.workflow.id,
      workflowVersionId: context.version.id,
      workflowVersion: context.version.version,
      name: dto.name,
      description: dto.description ?? null,
      cronExpression: dto.cronExpression,
      timezone: dto.timezone,
      humanLabel: dto.humanLabel ?? null,
      overlapPolicy: dto.overlapPolicy ?? 'skip',
      catchupWindowSeconds: dto.catchupWindowSeconds ?? 0,
      status: 'active',
      inputPayload: normalizedPayload,
      organizationId: context.organizationId,
    });

    const dispatchArgs = this.buildDispatchArgs({
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId,
      workflowVersion: record.workflowVersion,
      organizationId: record.organizationId ?? null,
      scheduleId: record.id,
      scheduleName: record.name,
      payload: normalizedPayload,
    });

    try {
      await this.temporalService.createSchedule({
        scheduleId: record.id,
        organizationId: context.organizationId,
        cronExpression: record.cronExpression,
        timezone: record.timezone,
        overlapPolicy: (record.overlapPolicy as ScheduleOverlapPolicy) ?? 'skip',
        catchupWindowSeconds: record.catchupWindowSeconds ?? 0,
        memo: {
          workflowId: record.workflowId,
          workflowVersionId: record.workflowVersionId,
          workflowVersion: record.workflowVersion,
          inputPayload: record.inputPayload,
        },
        dispatchArgs,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create Temporal schedule for ${record.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.repository.delete(record.id, { organizationId: context.organizationId });
      throw error;
    }

    const updated = await this.repository.update(
      record.id,
      {
        temporalScheduleId: record.id,
        temporalSnapshot: {},
      },
      { organizationId: context.organizationId },
    );

    return this.mapRecord(updated ?? record);
  }

  async update(
    auth: AuthContext | null,
    id: string,
    dto: UpdateScheduleRequestDto,
  ): Promise<WorkflowSchedule> {
    const existing = await this.findOwnedScheduleOrThrow(id, auth);
    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);

    const context = await this.workflowsService.getCompiledWorkflowContext(
      dto.workflowId ?? existing.workflowId,
      { versionId: dto.workflowVersionId ?? existing.workflowVersionId ?? undefined },
      auth,
    );

    const nextPayload =
      dto.inputPayload ?? (existing.inputPayload as ScheduleInputPayload);
    this.validateSchedulePayload(context.definition, nextPayload);

    const dispatchArgs = this.buildDispatchArgs({
      workflowId: context.workflow.id,
      workflowVersionId: context.version.id,
      workflowVersion: context.version.version,
      organizationId: existing.organizationId ?? null,
      scheduleId: existing.id,
      scheduleName: dto.name ?? existing.name,
      payload: nextPayload,
    });

    const temporalScheduleId = existing.temporalScheduleId ?? existing.id;
    if (temporalScheduleId) {
      await this.temporalService.updateSchedule({
        scheduleId: temporalScheduleId,
        organizationId: context.organizationId,
        cronExpression: dto.cronExpression ?? existing.cronExpression,
        timezone: dto.timezone ?? existing.timezone,
        overlapPolicy: (dto.overlapPolicy ??
          existing.overlapPolicy ??
          'skip') as ScheduleOverlapPolicy,
        catchupWindowSeconds: dto.catchupWindowSeconds ?? existing.catchupWindowSeconds ?? 0,
        memo: {
          workflowId: context.workflow.id,
          workflowVersionId: context.version.id,
          workflowVersion: context.version.version,
          inputPayload: nextPayload,
        },
        dispatchArgs,
      });
    }

    const updated = await this.repository.update(
      existing.id,
      {
        workflowId: context.workflow.id,
        workflowVersionId: context.version.id,
        workflowVersion: context.version.version,
        name: dto.name ?? existing.name,
        description: dto.description ?? existing.description,
        cronExpression: dto.cronExpression ?? existing.cronExpression,
        timezone: dto.timezone ?? existing.timezone,
        humanLabel: dto.humanLabel ?? existing.humanLabel,
        overlapPolicy: dto.overlapPolicy ?? existing.overlapPolicy,
        catchupWindowSeconds: dto.catchupWindowSeconds ?? existing.catchupWindowSeconds,
        status: dto.status ?? existing.status,
        inputPayload: nextPayload,
      },
      { organizationId: existing.organizationId },
    );

    if (!updated) {
      throw new NotFoundException(`Schedule ${id} not found`);
    }

    return this.mapRecord(updated);
  }

  async delete(auth: AuthContext | null, id: string): Promise<void> {
    const existing = await this.findOwnedScheduleOrThrow(id, auth);
    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);
    const temporalScheduleId = existing.temporalScheduleId ?? existing.id;
    if (temporalScheduleId) {
      await this.temporalService.deleteSchedule(temporalScheduleId).catch((error) => {
        this.logger.warn(
          `Failed to delete Temporal schedule ${temporalScheduleId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    await this.repository.delete(existing.id, { organizationId: existing.organizationId });
  }

  async pause(auth: AuthContext | null, id: string): Promise<WorkflowSchedule> {
    const existing = await this.findOwnedScheduleOrThrow(id, auth);
    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);
    const temporalScheduleId = existing.temporalScheduleId ?? existing.id;
    if (temporalScheduleId) {
      await this.temporalService.pauseSchedule(temporalScheduleId);
    }
    const updated = await this.repository.update(
      existing.id,
      { status: 'paused' },
      { organizationId: existing.organizationId },
    );
    return this.mapRecord(updated ?? existing);
  }

  async resume(auth: AuthContext | null, id: string): Promise<WorkflowSchedule> {
    const existing = await this.findOwnedScheduleOrThrow(id, auth);
    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);
    const temporalScheduleId = existing.temporalScheduleId ?? existing.id;
    if (temporalScheduleId) {
      await this.temporalService.resumeSchedule(temporalScheduleId);
    }
    const updated = await this.repository.update(
      existing.id,
      { status: 'active' },
      { organizationId: existing.organizationId },
    );
    return this.mapRecord(updated ?? existing);
  }

  async trigger(auth: AuthContext | null, id: string) {
    const existing = await this.findOwnedScheduleOrThrow(id, auth);
    await this.workflowsService.ensureWorkflowAdminAccess(existing.workflowId, auth);

    const payload = (existing.inputPayload as ScheduleInputPayload) ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    };

    const prepared = await this.workflowsService.prepareRunPayload(
      existing.workflowId,
      {
        inputs: payload.runtimeInputs ?? {},
        versionId: existing.workflowVersionId ?? undefined,
      },
      auth,
      {
        trigger: {
          type: 'schedule',
          sourceId: existing.id,
          label: existing.name,
        },
        nodeOverrides: payload.nodeOverrides ?? {},
      },
    );

    await this.workflowsService.startPreparedRun(prepared);
  }

  private async findOwnedScheduleOrThrow(id: string, auth: AuthContext | null) {
    const organizationId = this.requireOrganizationId(auth);
    const record = await this.repository.findById(id, { organizationId });
    if (!record) {
      throw new NotFoundException(`Schedule ${id} not found`);
    }
    return record;
  }

  private mapRecord(record: WorkflowScheduleRecord): WorkflowSchedule {
    const payload: ScheduleInputPayload =
      (record.inputPayload as ScheduleInputPayload) ?? {
        runtimeInputs: {},
        nodeOverrides: {},
      };

    return {
      id: record.id,
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId ?? null,
      workflowVersion: record.workflowVersion ?? null,
      name: record.name,
      description: record.description ?? null,
      cronExpression: record.cronExpression,
      timezone: record.timezone,
      humanLabel: record.humanLabel ?? null,
      overlapPolicy: (record.overlapPolicy as ScheduleOverlapPolicy) ?? 'skip',
      catchupWindowSeconds: record.catchupWindowSeconds ?? 0,
      status: (record.status as WorkflowSchedule['status']) ?? 'active',
      lastRunAt: record.lastRunAt ? record.lastRunAt.toISOString() : null,
      nextRunAt: record.nextRunAt ? record.nextRunAt.toISOString() : null,
      inputPayload: payload,
      temporalScheduleId: record.temporalScheduleId ?? null,
      temporalSnapshot: (record.temporalSnapshot as Record<string, unknown>) ?? {},
      organizationId: record.organizationId ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private buildDispatchArgs(options: {
    workflowId: string;
    workflowVersionId: string | null;
    workflowVersion: number | null;
    organizationId: string | null;
    scheduleId: string;
    scheduleName: string;
    payload: ScheduleInputPayload;
  }): ScheduleTriggerWorkflowArgs {
    const hasVersionId = Boolean(options.workflowVersionId);

    return {
      workflowId: options.workflowId,
      workflowVersionId: hasVersionId ? options.workflowVersionId ?? undefined : undefined,
      workflowVersion: hasVersionId ? undefined : options.workflowVersion ?? undefined,
      organizationId: options.organizationId ?? null,
      scheduleId: options.scheduleId,
      scheduleName: options.scheduleName,
      runtimeInputs: options.payload.runtimeInputs ?? {},
      nodeOverrides: options.payload.nodeOverrides ?? {},
      trigger: {
        type: 'schedule',
        sourceId: options.scheduleId,
        label: options.scheduleName,
      },
    };
  }

  private validateSchedulePayload(
    definition: WorkflowDefinition,
    payload: ScheduleInputPayload = { runtimeInputs: {}, nodeOverrides: {} },
  ) {
    const entrypoint = definition.actions.find(
      (action) => action.componentId === 'core.workflow.entrypoint',
    );
    if (!entrypoint) {
      throw new BadRequestException('Workflow requires an Entry Point to use schedules');
    }

    const runtimeInputs: Array<{ id?: string; required?: boolean }> = Array.isArray(
      entrypoint.params?.runtimeInputs,
    )
      ? entrypoint.params.runtimeInputs
      : [];

    for (const inputDef of runtimeInputs) {
      if (!inputDef?.id) {
        continue;
      }
      const value = payload.runtimeInputs?.[inputDef.id];
      if (inputDef.required !== false && (value === undefined || value === null)) {
        throw new BadRequestException(
          `Schedule requires value for runtime input "${inputDef.id}"`,
        );
      }
    }

    if (payload.nodeOverrides) {
      for (const nodeRef of Object.keys(payload.nodeOverrides)) {
        const action = definition.actions.find((candidate) => candidate.ref === nodeRef);
        if (!action) {
          throw new BadRequestException(`Unknown node override target "${nodeRef}"`);
        }
        const overrides = payload.nodeOverrides[nodeRef];
        if (overrides && typeof overrides !== 'object') {
          throw new BadRequestException(`Node override for "${nodeRef}" must be an object`);
        }
      }
    }
  }

  private requireOrganizationId(auth: AuthContext | null): string {
    if (!auth?.organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return auth.organizationId;
  }
}
