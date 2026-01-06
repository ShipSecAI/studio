import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  HttpException,
  StreamableFile,
  Headers,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
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
  TerminalChunksQueryDto,
  TerminalChunksQuerySchema,
  UpdateWorkflowRequestDto,
  UpdateWorkflowMetadataDto,
  UpdateWorkflowMetadataSchema,
  WorkflowResponseDto,
  ServiceWorkflowResponse,
  WorkflowVersionResponseDto,
  WorkflowRuntimeInputsResponseDto,
  ENTRY_POINT_COMPONENT_IDS,
  type RuntimeInput,
} from './dto/workflow-graph.dto';
import {
  TerminalArchiveRequestDto,
  TerminalRecordingDto,
  TerminalRecordListDto,
  TerminalRecordParamDto,
  TerminalArchiveRequestSchema,
  TerminalRecordParamSchema,
} from './dto/terminal-record.dto';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from './workflows.service';
import { TerminalStreamService } from '../terminal/terminal-stream.service';
import { TerminalArchiveService } from './terminal-archive.service';
import { LogStreamService } from '../trace/log-stream.service';
import { ArtifactsService } from '../storage/artifacts.service';
import type { Request, Response } from 'express';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { RequireWorkflowRole, WorkflowRoleGuard } from './workflow-role.guard';
import { RunArtifactsResponseDto } from '../storage/dto/artifact.dto';
import { ArtifactIdParamDto, ArtifactIdParamSchema } from '../storage/dto/artifacts.dto';
import type { WorkflowTerminalRecord } from '../database/schema';
import { NodeIOService } from '../node-io/node-io.service';

const TERMINAL_COMPLETION_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
]);

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
    type: { type: 'string' },
    details: {
      type: 'object',
      additionalProperties: true,
    },
    fieldErrors: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
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

const runConfigSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    workflowId: { type: 'string' },
    workflowVersionId: { type: 'string', nullable: true },
    workflowVersion: { type: 'integer', nullable: true },
    inputs: {
      type: 'object',
      additionalProperties: true,
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
    private readonly artifactsService: ArtifactsService,
    private readonly terminalStreamService: TerminalStreamService,
    private readonly terminalArchiveService: TerminalArchiveService,
    private readonly nodeIOService: NodeIOService,
  ) {}

  @Post()
  @ApiOkResponse({ type: WorkflowResponseDto })
  async create(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateWorkflowRequestDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.create(body, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Put(':id')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOkResponse({ type: WorkflowResponseDto })
  async update(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body() body: UpdateWorkflowRequestDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.update(id, body, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Patch(':id/metadata')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  @ApiOkResponse({ type: WorkflowResponseDto })
  async updateMetadata(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowMetadataSchema)) body: UpdateWorkflowMetadataDto,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.updateMetadata(id, body, auth);
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
              workflowVersionId: { type: 'string', nullable: true },
              workflowVersion: { type: 'number', nullable: true },
              workflowName: { type: 'string' },
              eventCount: { type: 'number' },
              nodeCount: { type: 'number' },
              duration: { type: 'number' },
              triggerType: {
                type: 'string',
                enum: ['manual', 'schedule', 'api'],
              },
              triggerSource: { type: 'string', nullable: true },
              triggerLabel: { type: 'string', nullable: true },
              inputPreview: {
                type: 'object',
                properties: {
                  runtimeInputs: {
                    type: 'object',
                    additionalProperties: true,
                  },
                  nodeOverrides: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async listRuns(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListRunsQuerySchema)) query: ListRunsQueryDto,
  ) {
    return this.workflowsService.listRuns(auth, {
      workflowId: query.workflowId,
      status: query.status,
      limit: query.limit,
    });
  }

  @Get('/runs/:runId')
  @ApiOkResponse({
    description: 'Metadata for a single workflow run',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workflowId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'CONTINUED_AS_NEW', 'TIMED_OUT', 'UNKNOWN'],
        },
        startTime: { type: 'string', format: 'date-time' },
        endTime: { type: 'string', format: 'date-time', nullable: true },
        temporalRunId: { type: 'string', nullable: true },
        workflowVersionId: { type: 'string', nullable: true },
        workflowVersion: { type: 'number', nullable: true },
        workflowName: { type: 'string' },
        eventCount: { type: 'number' },
        nodeCount: { type: 'number' },
        duration: { type: 'number' },
        triggerType: {
          type: 'string',
          enum: ['manual', 'schedule', 'api'],
        },
        triggerSource: { type: 'string', nullable: true },
        triggerLabel: { type: 'string', nullable: true },
        inputPreview: {
          type: 'object',
          properties: {
            runtimeInputs: {
              type: 'object',
              additionalProperties: true,
            },
            nodeOverrides: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  })
  async getRun(
    @CurrentAuth() auth: AuthContext | null,
    @Param('runId') runId: string,
  ) {
    return this.workflowsService.getRun(runId, auth);
  }

  @Get('/runs/:runId/children')
  @ApiOkResponse({
    description: 'List direct child workflow runs spawned by a parent run',
    schema: {
      type: 'object',
      properties: {
        runs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              runId: { type: 'string' },
              workflowId: { type: 'string' },
              workflowName: { type: 'string' },
              parentNodeRef: { type: 'string', nullable: true },
              status: { type: 'string' },
              startedAt: { type: 'string', format: 'date-time' },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },
    },
  })
  async listChildRuns(
    @CurrentAuth() auth: AuthContext | null,
    @Param('runId') runId: string,
  ) {
    return this.workflowsService.listChildRuns(runId, auth);
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowResponseDto })
  async findOne(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<WorkflowResponseDto> {
    const serviceResponse = await this.workflowsService.findById(id, auth);
    return this.transformServiceResponseToApi(serviceResponse);
  }

  @Get(':id/runtime-inputs')
  @ApiOkResponse({ 
    type: WorkflowRuntimeInputsResponseDto,
    description: 'Get the runtime inputs defined in the workflow Entry Point' 
  })
  async getRuntimeInputs(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
  ): Promise<WorkflowRuntimeInputsResponseDto> {
    const workflow = await this.workflowsService.findById(id, auth);
    
    // Find the entry point node by checking the component type
    const entryNode = workflow.graph.nodes.find(node => 
      ENTRY_POINT_COMPONENT_IDS.includes(node.type as any)
    );
    
    // Extract runtime inputs from the entry point's config
    const config = entryNode?.data?.config as Record<string, unknown> | undefined;
    const rawInputs = (config?.runtimeInputs as RuntimeInput[]) || [];
    
    // Normalize and validate the inputs
    const inputs: RuntimeInput[] = rawInputs.map(input => ({
      id: input.id,
      label: input.label || input.id,
      type: input.type === 'string' ? 'text' : input.type,
      required: input.required ?? true,
      description: input.description,
      defaultValue: input.defaultValue,
    }));
    
    return {
      workflowId: workflow.id,
      inputs,
    };
  }

  @Get(':workflowId/versions/:versionId')
  @ApiOkResponse({ type: WorkflowVersionResponseDto })
  async findVersion(
    @CurrentAuth() auth: AuthContext | null,
    @Param('workflowId') workflowId: string,
    @Param('versionId') versionId: string,
  ): Promise<WorkflowVersionResponseDto> {
    return this.workflowsService.getWorkflowVersion(workflowId, versionId, auth);
  }

  @Delete(':id')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
  async remove(@CurrentAuth() auth: AuthContext | null, @Param('id') id: string) {
    await this.workflowsService.delete(id, auth);
    return { status: 'deleted', id };
  }

  @Post(':id/commit')
  @UseGuards(WorkflowRoleGuard)
  @RequireWorkflowRole('ADMIN')
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
  
  async commit(@Param('id') id: string, @CurrentAuth() auth: AuthContext | null) {
    try {
      return await this.workflowsService.commit(id, auth);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : 'Commit failed';
      // Surface compile/validation details to the client for better UX
      throw new BadRequestException(message);
    }
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
        workflowVersionId: {
          type: 'string',
          description: 'Workflow version identifier used for execution',
        },
        workflowVersion: {
          type: 'integer',
          description: 'Workflow version number used for execution',
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
    @CurrentAuth() auth: AuthContext | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunWorkflowRequestSchema))
    body: RunWorkflowRequestDto,
    @Headers() headers?: Record<string, string | string[] | undefined>,
  ) {
    try {
      const idempotencyKey = this.extractIdempotencyKey(headers);
      const prepared = await this.workflowsService.prepareRunPayload(
        id,
        {
          inputs: body.inputs,
          versionId: body.versionId,
          version: body.version,
        },
        auth,
        { idempotencyKey },
      );

      return await this.workflowsService.startPreparedRun(prepared);
    } catch (error) {
      if (error instanceof HttpException) throw error;

      // Extract detailed error information
      const message = error instanceof Error ? error.message : 'Failed to run workflow';
      const errorDetails: any = {
        message,
        error: 'Bad Request',
        statusCode: 400,
      };

      // Include stack trace and cause only in development to avoid leaking internal details
      const isDevelopment = process.env.NODE_ENV !== 'production';
      if (isDevelopment) {
        if (error instanceof Error && error.stack) {
          errorDetails.stack = error.stack;
        }

        if (error instanceof Error && (error as any).cause) {
          errorDetails.cause = (error as any).cause;
        }
      }

      throw new BadRequestException(errorDetails);
    }
  }

  @Get('/runs/:runId/status')
  @ApiOkResponse({
    description: 'Current Temporal execution status',
  })
  async status(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const result = await this.workflowsService.getRunStatus(runId, query.temporalRunId, auth);
    if (TERMINAL_COMPLETION_STATUSES.has(result.status)) {
      this.terminalArchiveService.archiveRun(auth, runId).catch((error) => {
        console.warn(`Failed to archive terminal after status fetch for run ${runId}`, error);
      });
    }
    return result;
  }

  @Get('/runs/:runId/result')
  @ApiOkResponse({
    description: 'Resolved workflow result payload',
  })
  async result(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const result = await this.workflowsService.getRunResult(runId, query.temporalRunId, auth);
    return { runId, result };
  }

  @Get('/runs/:runId/config')
  @ApiOkResponse({
    description: 'Inputs and version metadata captured for a workflow run',
    schema: runConfigSchema,
  })
  async config(
    @Param('runId') runId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.workflowsService.getRunConfig(runId, auth);
  }

  @Post('/runs/:runId/cancel')
  @ApiOkResponse({
    description: 'Cancels a running workflow execution',
  })
  async cancel(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TemporalRunQuerySchema)) query: TemporalRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.cancelRun(runId, query.temporalRunId, auth);
    return { status: 'cancelled', runId };
  }

  @Get('/runs/:runId/trace')
  @ApiOkResponse({
    description: 'Trace events for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async trace(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events, cursor } = await this.traceService.list(runId, auth);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/events')
  @ApiOkResponse({
    description: 'Full event timeline for a workflow run',
    schema: traceEnvelopeSchema,
  })
  async events(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events, cursor } = await this.traceService.list(runId, auth);
    return { runId, events, cursor };
  }

  @Get('/runs/:runId/dataflows')
  @ApiOkResponse({
    description: 'Derived data flow packets for a workflow run',
    schema: dataFlowEnvelopeSchema,
  })
  async dataflows(@Param('runId') runId: string, @CurrentAuth() auth: AuthContext | null) {
    const { events } = await this.traceService.list(runId, auth);
    const packets = await this.workflowsService.buildDataFlows(runId, events);
    return { runId, packets };
  }

  @Get('/runs/:runId/artifacts')
  @ApiOkResponse({
    description: 'Artifacts generated for a workflow run',
    type: RunArtifactsResponseDto,
  })
  async runArtifacts(
    @Param('runId') runId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.artifactsService.listRunArtifacts(auth, runId);
  }

  @Get('/runs/:runId/artifacts/:artifactId/download')
  @ApiOkResponse({
    description: 'Download artifact for a specific run',
  })
  async downloadRunArtifact(
    @Param('runId') runId: string,
    @Param(new ZodValidationPipe(ArtifactIdParamSchema)) params: ArtifactIdParamDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { artifact, buffer, file } = await this.artifactsService.downloadArtifactForRun(
      auth,
      runId,
      params.id,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
    res.setHeader('Content-Length', file.size.toString());

    return new StreamableFile(buffer);
  }

  @Get('/runs/:runId/node-io')
  @ApiOkResponse({
    description: 'Node inputs/outputs for a workflow run',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeRef: { type: 'string' },
              componentId: { type: 'string' },
              status: { type: 'string', enum: ['running', 'completed', 'failed', 'skipped'] },
              startedAt: { type: 'string', format: 'date-time', nullable: true },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
              durationMs: { type: 'number', nullable: true },
              inputs: { type: 'object', additionalProperties: true, nullable: true },
              outputs: { type: 'object', additionalProperties: true, nullable: true },
              inputsSize: { type: 'number' },
              outputsSize: { type: 'number' },
              inputsSpilled: { type: 'boolean' },
              outputsSpilled: { type: 'boolean' },
              errorMessage: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  async getNodeIO(
    @Param('runId') runId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const nodes = await this.nodeIOService.listDetails(runId, auth?.organizationId);
    return { runId, nodes };
  }

  @Get('/runs/:runId/node-io/:nodeRef')
  @ApiQuery({ name: 'full', required: false, type: Boolean, description: 'Request full node I/O data instead of a preview' })
  @ApiOkResponse({
    description: 'Specific node input/output for a workflow run',
    schema: {
      type: 'object',
      properties: {
        nodeRef: { type: 'string' },
        componentId: { type: 'string' },
        status: { type: 'string', enum: ['running', 'completed', 'failed', 'skipped'] },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        durationMs: { type: 'number', nullable: true },
        inputs: { type: 'object', additionalProperties: true, nullable: true },
        outputs: { type: 'object', additionalProperties: true, nullable: true },
        inputsSize: { type: 'number' },
        outputsSize: { type: 'number' },
        inputsSpilled: { type: 'boolean' },
        outputsSpilled: { type: 'boolean' },
        inputsTruncated: { type: 'boolean' },
        outputsTruncated: { type: 'boolean' },
        errorMessage: { type: 'string', nullable: true },
      },
    },
  })
  async getNodeIODetail(
    @Param('runId') runId: string,
    @Param('nodeRef') nodeRef: string,
    @Query('full') full: string | undefined,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const isFull = full === 'true' || full === '1';
    const nodeIO = await this.nodeIOService.getNodeIO(runId, nodeRef, isFull);
    if (!nodeIO) {
      throw new BadRequestException(`Node I/O not found for node ${nodeRef} in run ${runId}`);
    }
    return nodeIO;
  }

  @Get('/runs/:runId/stream')
  @ApiOkResponse({ description: 'Server-sent events stream for workflow run updates' })
  async stream(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(StreamRunQuerySchema)) query: StreamRunQueryDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    // Auth is now handled via headers (Authorization and X-Organization-Id)
    // using a fetch-based SSE client that supports custom headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    await this.workflowsService.ensureRunAccess(runId, auth);

    let lastSequence = Number.parseInt(query.cursor ?? '0', 10);
    let terminalCursor = query.terminalCursor;
    let lastLogCursor = query.logCursor ?? null;
    if (Number.isNaN(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

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
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        // Flush headers if available (helps with immediate delivery)
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      } catch (error) {
        // Connection closed or error writing
        console.warn(`Failed to send SSE event ${event}:`, error);
        if (!active) {
          return;
        }
        active = false;
        void cleanup();
      }
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
        const { events, cursor } = await this.traceService.listSince(runId, lastSequence, auth);
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

        const terminal = await this.terminalStreamService.fetchChunks(runId, {
          cursor: terminalCursor,
        });
        if (terminal.chunks.length > 0) {
          terminalCursor = terminal.cursor;
          send('terminal', { runId, ...terminal });
        }

        const { logs: newLogs, cursor: nextCursor } = await this.logStreamService.fetchRecentLogs(
          runId,
          auth?.organizationId ?? null,
          lastLogCursor,
        );
        if (newLogs.length > 0) {
          lastLogCursor = nextCursor ?? lastLogCursor;
          send('logs', { logs: newLogs, cursor: lastLogCursor });
        }
      } catch (error) {
        send('error', { message: 'trace_fetch_failed', detail: String(error) });
      }

      try {
        const status = await this.workflowsService.getRunStatus(runId, query.temporalRunId, auth);
        const signature = JSON.stringify(status);
        if (signature !== lastStatusSignature) {
          lastStatusSignature = signature;
          send('status', status);
          if (TERMINAL_COMPLETION_STATUSES.has(status.status)) {
            this.terminalArchiveService.archiveRun(auth, runId).catch((error) => {
              console.warn(`Failed to archive terminal for run ${runId}`, error);
            });
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
    let useRealtime = false;

    try {
      const traceRepo = (this.traceService as any).repository;
      if (traceRepo && typeof traceRepo.subscribeToRun === 'function') {
        unsubscribe = await traceRepo.subscribeToRun(runId, async (payload: string) => {
          if (!active) return;

          try {
            const notification = JSON.parse(payload);
            if (notification.sequence > lastSequence) {
              const { events } = await this.traceService.listSince(runId, lastSequence, auth);
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

        useRealtime = true;
        console.log(`[Stream] Setting up realtime mode for run ${runId}`);
        send('ready', { mode: 'realtime', runId });
      } else {
        throw new Error('Repository does not support LISTEN/NOTIFY');
      }
    } catch (error) {
      // Fallback to polling mode if LISTEN/NOTIFY fails
      console.warn(`[Stream] Failed to set up LISTEN/NOTIFY for run ${runId}, falling back to polling:`, error);
      send('ready', { mode: 'polling', runId, interval: 1000 });
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
    }

    await pump();
    console.log(`[Stream] Initial pump completed for run ${runId}, mode: ${useRealtime ? 'realtime' : 'polling'}`);

    // Always run a lightweight poll loop so terminal chunks are flushed even when TRACE notifications are realtime.
    // Only create this interval if we don't already have one (polling mode already has one)
    if (!intervalId) {
      intervalId = setInterval(() => {
        void pump();
      }, 1000);
      console.log(`[Stream] Started backup polling interval for run ${runId}`);
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
    description: 'Logs for a workflow run',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        logs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              runId: { type: 'string' },
              nodeId: { type: 'string' },
              level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
              message: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
        totalCount: { type: 'number' },
        hasMore: { type: 'boolean' },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  async logs(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(WorkflowLogsQuerySchema))
    query: WorkflowLogsQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    return this.logStreamService.fetch(runId, auth, {
      nodeRef: query.nodeRef,
      stream: query.stream,
      level: query.level,
      limit: query.limit,
      cursor: query.cursor,
      startTime: query.startTime,
      endTime: query.endTime,
    });
  }

  @Get('/runs/:runId/terminal')
  @ApiOkResponse({
    description: 'Terminal chunks for a workflow run',
  })
  async terminalChunks(
    @Param('runId') runId: string,
    @Query(new ZodValidationPipe(TerminalChunksQuerySchema))
    query: TerminalChunksQueryDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    await this.workflowsService.ensureRunAccess(runId, auth);
    const result = await this.terminalStreamService.fetchChunks(runId, {
      cursor: query.cursor,
      nodeRef: query.nodeRef,
      stream: query.stream,
      startTime: query.startTime ? new Date(query.startTime) : undefined,
      endTime: query.endTime ? new Date(query.endTime) : undefined,
    });
    if (result.chunks.length > 0 || !query.nodeRef) {
      return { runId, ...result };
    }

    try {
      const archived = await this.terminalArchiveService.replay(auth, runId, {
        nodeRef: query.nodeRef,
        stream: query.stream,
        cursor: query.cursor,
      });
      return { runId, ...archived };
    } catch (error) {
      console.warn(`Failed to replay archived terminal for ${runId}`, error);
      return { runId, ...result };
    }
  }

  @Post('/runs/:runId/terminal/archive')
  @ApiCreatedResponse({ type: TerminalRecordingDto })
  async archiveTerminal(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(TerminalArchiveRequestSchema))
    body: TerminalArchiveRequestDto,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const record = await this.terminalArchiveService.archive(auth, runId, body);
    return this.toTerminalRecordingDto(record);
  }

  @Get('/runs/:runId/terminal/archive')
  @ApiOkResponse({ type: TerminalRecordListDto })
  async listTerminalArchives(
    @Param('runId') runId: string,
    @CurrentAuth() auth: AuthContext | null,
  ) {
    const records = await this.terminalArchiveService.list(auth, runId);
    return {
      runId,
      records: records.map((record) => this.toTerminalRecordingDto(record)),
    };
  }

  @Get('/runs/:runId/terminal/archive/:recordId/download')
  @ApiOkResponse({ description: 'Download terminal recording' })
  async downloadTerminalArchive(
    @Param('runId') runId: string,
    @Param(new ZodValidationPipe(TerminalRecordParamSchema))
    params: TerminalRecordParamDto,
    @CurrentAuth() auth: AuthContext | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, file } = await this.terminalArchiveService.download(
      auth,
      runId,
      params.recordId,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.size.toString());

    return new StreamableFile(buffer);
  }

  @Get()
  @ApiOkResponse({ type: [WorkflowResponseDto] })
  async findAll(@CurrentAuth() auth: AuthContext | null): Promise<WorkflowResponseDto[]> {
    const serviceResponses = await this.workflowsService.list(auth);
    return serviceResponses.map(response => this.transformServiceResponseToApi(response));
  }

  private transformServiceResponseToApi(serviceResponse: ServiceWorkflowResponse): WorkflowResponseDto {
    return {
      ...serviceResponse,
      lastRun: serviceResponse.lastRun?.toISOString() ?? null,
      createdAt: serviceResponse.createdAt.toISOString(),
      updatedAt: serviceResponse.updatedAt.toISOString(),
    };
  }

  private toTerminalRecordingDto(record: WorkflowTerminalRecord): TerminalRecordingDto {
    return {
      id: record.id,
      runId: record.runId,
      nodeRef: record.nodeRef,
      stream: record.stream,
      fileId: record.fileId,
      chunkCount: record.chunkCount,
      durationMs: record.durationMs,
      createdAt: (record.createdAt ?? new Date()).toISOString(),
    };
  }

  private extractIdempotencyKey(
    headers: Record<string, string | string[] | undefined> | undefined,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    const normalized = Object.entries(headers).reduce<
      Record<string, string | string[] | undefined>
    >((acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    }, {});

    for (const candidate of ['idempotency-key', 'x-idempotency-key']) {
      const raw = normalized[candidate];
      if (Array.isArray(raw)) {
        const first = raw.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
        if (first) {
          return first;
        }
      } else if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw;
      }
    }

    return undefined;
  }
}
