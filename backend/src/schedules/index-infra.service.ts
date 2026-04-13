import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { SchedulesService } from './schedules.service';
import { SystemWorkflowsService } from '../workflows/system-workflows.service';
import { WorkflowsService, type WorkflowRunHandle } from '../workflows/workflows.service';
import type { ExecutionTriggerMetadata, WorkflowSchedule } from '@shipsec/shared';

export const INDEX_INFRA_TEMPLATE_SLUG = 'sys-index-infra';
export const INDEX_INFRA_SCHEDULE_NAME = 'Index Infra';
export const INDEX_INFRA_DEFAULT_CRON = '0 2 * * *';
export const INDEX_INFRA_DEFAULT_TIMEZONE = 'UTC';
export const INDEX_INFRA_DEFAULT_HUMAN_LABEL = 'Daily at 2:00 AM (UTC)';

@Injectable()
export class IndexInfraService {
  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly systemWorkflowsService: SystemWorkflowsService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async ensureIndexInfraWorkflow(
    auth: AuthContext,
  ): Promise<{ id: string; name: string; slug: string | null }> {
    const workflows = await this.systemWorkflowsService.ensureSystemWorkflows(
      auth.organizationId ?? '',
    );
    const workflow = workflows.find((item) => item.slug === INDEX_INFRA_TEMPLATE_SLUG);
    if (!workflow) {
      throw new NotFoundException(`System workflow ${INDEX_INFRA_TEMPLATE_SLUG} not found`);
    }
    return workflow;
  }

  async ensureDefaultSchedule(auth: AuthContext): Promise<WorkflowSchedule> {
    return this.ensureDefaultScheduleForIntegration(auth);
  }

  async ensureDefaultScheduleForIntegration(
    auth: AuthContext,
    integrationId?: string,
  ): Promise<WorkflowSchedule> {
    const workflow = await this.ensureIndexInfraWorkflow(auth);
    const current = await this.workflowsService.findById(workflow.id, auth);
    const schedules = await this.schedulesService.list(auth, { workflowId: workflow.id });
    const existing = schedules[0];
    const inputPayload = {
      runtimeInputs: integrationId ? { integrationId } : {},
      nodeOverrides: {},
    };

    if (!existing) {
      return this.schedulesService.create(auth, {
        workflowId: workflow.id,
        workflowVersionId: current.currentVersionId ?? undefined,
        name: INDEX_INFRA_SCHEDULE_NAME,
        description: 'Keep cloud inventory indexed in Cartography on a daily cadence.',
        cronExpression: INDEX_INFRA_DEFAULT_CRON,
        timezone: INDEX_INFRA_DEFAULT_TIMEZONE,
        humanLabel: INDEX_INFRA_DEFAULT_HUMAN_LABEL,
        overlapPolicy: 'skip',
        catchupWindowSeconds: 0,
        inputPayload,
      });
    }

    const existingIntegrationId =
      typeof existing.inputPayload?.runtimeInputs?.integrationId === 'string'
        ? existing.inputPayload.runtimeInputs.integrationId
        : undefined;

    if (
      (current.currentVersionId && existing.workflowVersionId !== current.currentVersionId) ||
      (integrationId && existingIntegrationId !== integrationId)
    ) {
      return this.schedulesService.update(auth, existing.id, {
        workflowVersionId: current.currentVersionId ?? undefined,
        name: existing.name,
        cronExpression: existing.cronExpression,
        timezone: existing.timezone,
        humanLabel: existing.humanLabel ?? INDEX_INFRA_DEFAULT_HUMAN_LABEL,
        inputPayload: integrationId
          ? {
              runtimeInputs: {
                ...(existing.inputPayload?.runtimeInputs ?? {}),
                integrationId,
              },
              nodeOverrides: existing.inputPayload?.nodeOverrides ?? {},
            }
          : existing.inputPayload,
      });
    }

    return existing;
  }

  async triggerRun(input: {
    auth: AuthContext;
    integrationId?: string;
    trigger: ExecutionTriggerMetadata;
  }): Promise<WorkflowRunHandle> {
    const workflow = await this.ensureIndexInfraWorkflow(input.auth);
    return this.workflowsService.run(
      workflow.id,
      {
        inputs: input.integrationId ? { integrationId: input.integrationId } : {},
      },
      input.auth,
      {
        trigger: input.trigger,
      },
    );
  }
}
