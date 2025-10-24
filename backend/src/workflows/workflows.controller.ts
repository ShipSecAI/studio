import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  CreateWorkflowRequestDto,
  ListRunsQueryDto,
  ListRunsQuerySchema,
  RunWorkflowRequestDto,
  RunWorkflowRequestSchema,
  StreamRunQueryDto,
  StreamRunQuerySchema,
  TemporalRunQueryDto,
  TemporalRunQuerySchema,
  WorkflowLogsQueryDto,
  WorkflowLogsQuerySchema,
  UpdateWorkflowRequestDto,
  WorkflowGraphSchema,
  WorkflowResponseDto,
  WorkflowResponse,
  WorkflowResponseSchema,
  ServiceWorkflowResponse,
} from './dto/workflow-graph.dto';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from './workflows.service';
import { LogStreamService } from '../trace/log-stream.service';
import type { Request, Response } from 'express';

const traceFailureSchema = {
  type: 'object',
  properties: {
    at: { type: 'string', format: 'date-time' },
    reason: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        name: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const traceRetryPolicySchema = {
  type: 'object',
  properties: {
    maxAttempts: { type: 'integer', minimum: 1 },
    initialIntervalSeconds: { type: 'number', minimum: 0 },
    maximumIntervalSeconds: { type: 'number', minimum: 0 },
    backoffCoefficient: { type: 'number', minimum: 0 },
    nonRetryableErrorTypes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
};

const traceMetadataSchema = {
  type: 'object',
  properties: {
    activityId: { type: 'string' },
    attempt: { type: 'integer', minimum: 0 },
    correlationId: { type: 'string' },
    streamId: { type: 'string' },
    joinStrategy: {
      type: 'string',
      enum: ['all', 'any', 'first'],
    },
    triggeredBy: { type: 'string' },
    failure: { ...traceFailureSchema, nullable: true },
    retryPolicy: { ...traceRetryPolicySchema, nullable: true },
  },
  additionalProperties: false,
};

const traceErrorSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    stack: { type: 'string' },
    code: { type: 'string' },
  },
  additionalProperties: false,
};

const traceEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    nodeId: { type: 'string' },
    type: {
      type: 'string',
      enum: ['STARTED', 'PROGRESS', 'COMPLETED', 'FAILED'],
    },
    level: {
      type: 'string',
      enum: ['info', 'warn', 'error', 'debug'],
    },
    timestamp: { type: 'string', format: 'date-time' },
    message: { type: 'string', nullable: true },
    error: { ...traceErrorSchema, nullable: true },
    outputSummary: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    data: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    metadata: { ...traceMetadataSchema, nullable: true },
  },
  additionalProperties: false,
};

const traceEnvelopeSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    events: {
      type: 'array',
      items: traceEventSchema,
    },
    cursor: { type: 'string', nullable: true },
  },
  additionalProperties: false,
};

const dataFlowPacketSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    runId: { type: 'string' },
    sourceNode: { type: 'string' },
    targetNode: { type: 'string' },
    inputKey: { type: 'string', nullable: true },
    payload: {
      type: 'object',
      additionalProperties: true,
      nullable: true,
    },
    timestamp: { type: 'integer' },
    visualTime: { type: 'number' },
    size: { type: 'number' },
    type: {
      type: 'string',
      enum: ['file', 'json', 'text', 'binary'],
    },
  },
  additionalProperties: false,
};

const dataFlowEnvelopeSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    packets: {
      type: 'array',
      items: dataFlowPacketSchema,
    },
  },
  additionalProperties: false,
};

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly traceService: TraceService,
    private readonly logStreamService: LogStreamService,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(WorkflowGraphSchema))
  @ApiOkResponse({ type: WorkflowResponseDto })
  async create(@Body() body: CreateWorkflowRequestDto): Promise<WorkflowResponse> {
    const serviceResponse = await this.workflowsService.create(body);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Put(':id')
  @ApiOkResponse({ type: WorkflowResponseDto })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WorkflowGraphSchema)) body: UpdateWorkflowRequestDto,
  ): Promise<WorkflowResponse> {
    const serviceResponse = await this.workflowsService.update(id, body);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Get('/runs')
  @ApiOkResponse({
    description: 'List all workflow runs with metadata',
    schema: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              workflowId: { type: 'string' },
              status: {
                type: 'string',
                enum: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'CONTINUED_AS_NEW', 'TIMED_OUT', 'UNKNOWN']
              },
              startTime: { type: 'string', format: 'date-time' },
              endTime: { type: 'string', format: 'date-time', nullable: true },
              temporalRunId: { type: 'string' },
              workflowName: { type: 'string' },
              eventCount: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async listRuns(
    @Query(new ZodValidationPipe(ListRunsQuerySchema)) query: ListRunsQueryDto,
  ) {
    return this.workflowsService.listRuns({
      workflowId: query.workflowId,
      status: query.status,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowResponseDto })
  async findOne(@Param('id') id: string): Promise<WorkflowResponse> {
    const serviceResponse = await this.workflowsService.findById(id);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.workflowsService.delete(id);
    return { status: 'deleted', id };
  }

  @Post(':id/commit')
  @ApiOkResponse({
    description: 'Compiled workflow definition',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', nullable: true },
        entrypoint: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
          },
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              componentId: { type: 'string' },
              params: {
                type: 'object',
                additionalProperties: true,
              },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
        config: {
          type: 'object',
          properties: {
            environment: { type: 'string' },
            timeoutSeconds: { type: 'number' },
          },
        },
      },
    },
  })
  async commit(@Param('id') id: string) {
    return this.workflowsService.commit(id);
  }

  @Post(':id/run')
  @ApiCreatedResponse({
    description: 'Workflow execution result',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Temporal workflow identifier' },
        workflowId: { type: 'string', description: 'Workflow record id' },
        temporalRunId: {
          type: 'string',
          description: 'Temporal first execution run id',
        },
        taskQueue: {
          type: 'string',
          description: 'Temporal task queue used for execution',
        },
        status: {
          type: 'string',
          enum: [
            'RUNNING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
            'TERMINATED',
            'CONTINUED_AS_NEW',
            'TIMED_OUT',
            'UNKNOWN',
          ],
        },
      },
    },
  })
  async run(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunWorkflowRequestSchema))
    body: RunWorkflowRequestDto,
  ) {
    return this.workflowsService.run(id, {
      inputs: body.inputs,
    });
  }

  @Get('/runs/:runId/status')
  @ApiOkResponse({
    description: 'Current Temporal execution status',
  })
  async status(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
  ) {
    return this.workflowsService.getRunStatus(runId, query.temporalRunId);
  }

  @Get('/runs/:runId/result')
  @ApiOkResponse({
    description: 'Resolved workflow result payload',
  })
  async result(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
  ) {
    const result = await this.workflowsService.getRunResult(runId, query.temporalRunId);
    return { runId, result };
  }

  @Post('/runs/:runId/cancel')
  @ApiOkResponse({
    description: 'Cancels a running workflow execution',
  })
  async cancel(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
  ) {
    await this.workflowsService.cancelRun(runId, query.temporalRunId);
    return { status: 'cancelled', runId };
  }

  @Get('/runs/:runId/trace')
  @ApiOkResponse({
    description: 'Trace events for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async trace(@Param('runId') runId: string) {
    const { events, cursor } = await this.traceService.list(runId);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/events')
  @ApiOkResponse({
    description: 'Full event timeline for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async events(@Param('runId') runId: string) {
    const { events, cursor } = await this.traceService.list(runId);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/dataflows')
  @ApiOkResponse({
    description: 'Derived data flow packets for a workflow run',
    schema: dataFlowEnvelopeSchema,
  })
  async dataflows(@Param('runId') runId: string) {
    const { events } = await this.traceService.list(runId);
    const packets = await this.workflowsService.buildDataFlows(runId, events);
    return { runId, packets };
  }

  @Get('/runs/:runId/stream')
  @ApiOkResponse({ description: 'Server-sent events stream for workflow run updates' })
  async stream(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(StreamRunQuerySchema)) query: StreamRunQueryDto,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    let lastSequence = Number.parseInt(query.cursor ?? '0', 10);
    if (Number.isNaN(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

    const terminalStatuses = new Set([
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'TERMINATED',
      'TIMED_OUT',
    ]);

    let active = true;
    let lastStatusSignature: string | null = null;
    let intervalId: NodeJS.Timeout | undefined;
    let heartbeatId: NodeJS.Timeout | undefined;
    let earliestEventTimestamp: number | null = null;
    let latestEventTimestamp: number | null = null;

    const send = (event: string, payload: unknown) => {
      if (!active) {
        return;
      }
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const cleanup = async () => {
      if (!active) {
        return;
      }
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
      }
      if (unsubscribe) {
        try {
          await unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing from trace events:', error);
        }
      }
      await this.workflowsService.releaseFlowContext(runId).catch((error) => {
        console.warn('Failed to clear flow context:', error);
      });
      res.end();
    };

    const pump = async () => {
      if (!active) {
        return;
      }

      try {
        const { events, cursor } = await this.traceService.listSince(runId, lastSequence);
        if (events.length > 0) {
          const lastId = events[events.length - 1]?.id;
          if (lastId) {
            const parsed = Number.parseInt(lastId, 10);
            if (!Number.isNaN(parsed)) {
              lastSequence = parsed;
            }
          }
          send('trace', { events, cursor: cursor ?? lastSequence.toString() });

          const timestamps = events
            .map((event) => Date.parse(event.timestamp))
            .filter((value) => !Number.isNaN(value));
          if (timestamps.length > 0) {
            const first = Math.min(...timestamps);
            const last = Math.max(...timestamps);
            if (earliestEventTimestamp === null || first < earliestEventTimestamp) {
              earliestEventTimestamp = first;
            }
            if (latestEventTimestamp === null || last > latestEventTimestamp) {
              latestEventTimestamp = last;
            }

            const packets = await this.workflowsService.buildDataFlows(runId, events, {
              baseTimestamp: earliestEventTimestamp ?? first,
              latestTimestamp: latestEventTimestamp ?? last,
            });

            if (packets.length > 0) {
              send('dataflow', { packets });
            }
          }
        }
      } catch (error) {
        send('error', { message: 'trace_fetch_failed', detail: String(error) });
      }

      try {
        const status = await this.workflowsService.getRunStatus(runId, query.temporalRunId);
        const signature = JSON.stringify(status);
        if (signature !== lastStatusSignature) {
          lastStatusSignature = signature;
          send('status', status);
          if (terminalStatuses.has(status.status)) {
            send('complete', { runId, status: status.status });
            cleanup();
          }
        }
      } catch (error) {
        send('error', { message: 'status_fetch_failed', detail: String(error) });
      }
    };

    // Try to set up real-time LISTEN/NOTIFY subscription
    let unsubscribe: (() => Promise<void>) | undefined;

    try {
      const traceRepo = (this.traceService as any).repository;
      if (traceRepo && typeof traceRepo.subscribeToRun === 'function') {
        unsubscribe = await traceRepo.subscribeToRun(runId, async (payload: string) => {
          if (!active) return;

          try {
            const notification = JSON.parse(payload);
            if (notification.sequence > lastSequence) {
              const { events } = await this.traceService.listSince(runId, lastSequence);
              if (events.length > 0) {
                const lastId = events[events.length - 1]?.id;
                if (lastId) {
                  const parsed = Number.parseInt(lastId, 10);
                  if (!Number.isNaN(parsed)) {
                    lastSequence = parsed;
                  }
                }
                send('trace', { events, cursor: lastSequence.toString() });

                const timestamps = events
                  .map((event) => Date.parse(event.timestamp))
                  .filter((value) => !Number.isNaN(value));
                if (timestamps.length > 0) {
                  const first = Math.min(...timestamps);
                  const last = Math.max(...timestamps);
                  if (earliestEventTimestamp === null || first < earliestEventTimestamp) {
                    earliestEventTimestamp = first;
                  }
                  if (latestEventTimestamp === null || last > latestEventTimestamp) {
                    latestEventTimestamp = last;
                  }

                  const packets = await this.workflowsService.buildDataFlows(runId, events, {
                    baseTimestamp: earliestEventTimestamp ?? first,
                    latestTimestamp: latestEventTimestamp ?? last,
                  });

                  if (packets.length > 0) {
                    send('dataflow', { packets });
                  }
                }
              }
            }
          } catch (error) {
            send('error', { message: 'notification_parse_failed', detail: String(error) });
          }
        });

        send('ready', { mode: 'realtime', runId });
      } else {
        throw new Error('Repository does not support LISTEN/NOTIFY');
      }
    } catch (error) {
      // Fallback to polling mode if LISTEN/NOTIFY fails
      console.warn('Failed to set up LISTEN/NOTIFY, falling back to polling:', error);
      send('ready', { mode: 'polling', runId, interval: 1000 });
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
    }

    await pump();

    // Only set up polling if not using realtime mode
    if (!unsubscribe) {
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
    }

    heartbeatId = setInterval(() => {
      if (!active) {
        return;
      }
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', cleanup);
  }

  @Get('/runs/:runId/logs')
  @ApiOkResponse({
    description: 'Log streams for a workflow run',
  })
  async logs(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(WorkflowLogsQuerySchema))
    query: WorkflowLogsQueryDto,
  ) {
    return this.logStreamService.fetch(runId, {
      nodeRef: query.nodeRef,
      stream: query.stream,
      limit: query.limit,
    });
  }

  @Get()
  @ApiOkResponse({ type: [WorkflowResponseDto] })
  async findAll(): Promise<WorkflowResponse[]> {
    const serviceResponses = await this.workflowsService.list();
    return serviceResponses.map(response => this.transformServiceResponseToApi(response));
  }

  private transformServiceResponseToApi(serviceResponse: ServiceWorkflowResponse): WorkflowResponse {
    return {
      ...serviceResponse,
      lastRun: serviceResponse.lastRun?.toISOString() ?? null,
      createdAt: serviceResponse.createdAt.toISOString(),
      updatedAt: serviceResponse.updatedAt.toISOString(),
    };
  }
}
