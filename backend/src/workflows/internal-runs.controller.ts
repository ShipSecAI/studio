import { Body, Controller, Post } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ExecutionTriggerMetadata } from '@shipsec/shared';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import {
  PrepareRunRequestDto,
  PrepareRunRequestSchema,
} from './dto/workflow-graph.dto';
import { WorkflowsService } from './workflows.service';

@Controller('internal/runs')
export class InternalRunsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  async prepareRun(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(PrepareRunRequestSchema))
    body: PrepareRunRequestDto,
  ) {
    const triggerOverride = body.trigger as ExecutionTriggerMetadata | undefined;
    const triggerMetadata =
      triggerOverride ??
      ({
        type: 'api',
        sourceId: auth?.userId ?? null,
        label: 'Internal run request',
      } satisfies ExecutionTriggerMetadata);

    const prepared = await this.workflowsService.prepareRunPayload(
      body.workflowId,
      {
        inputs: body.inputs,
        versionId: body.versionId,
        version: body.version,
      },
      auth,
      {
        trigger: triggerMetadata,
        nodeOverrides: body.nodeOverrides ?? undefined,
        runId: body.runId,
        idempotencyKey: body.idempotencyKey,
      },
    );

    return {
      runId: prepared.runId,
      workflowId: prepared.workflowId,
      workflowVersionId: prepared.workflowVersionId,
      workflowVersion: prepared.workflowVersion,
      organizationId: prepared.organizationId,
      definition: prepared.definition,
      inputs: prepared.inputs,
      trigger: prepared.triggerMetadata,
      inputPreview: prepared.inputPreview,
    };
  }
}
