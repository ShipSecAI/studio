import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
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
  UpdateWorkflowRequestDto,
  WorkflowGraphDto,
  WorkflowGraphSchema,
} from './dto/workflow-graph.dto';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly traceService: TraceService,
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(WorkflowGraphSchema))
  async create(@Body() body: CreateWorkflowRequestDto) {
    return this.workflowsService.create(body);
  }

  @Put(':id')
  @UsePipes(new ZodValidationPipe(WorkflowGraphSchema))
  async update(@Param('id') id: string, @Body() body: UpdateWorkflowRequestDto) {
    return this.workflowsService.update(id, body);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.workflowsService.findById(id);
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
        runId: { type: 'string', description: 'Execution run identifier' },
        outputs: {
          type: 'object',
          additionalProperties: true,
          description: 'Outputs keyed by node reference',
        },
      },
    },
  })
  async run(
    @Param('id') id: string,
    @Body() body: { inputs?: Record<string, unknown> } = {},
  ) {
    return this.workflowsService.run(id, body);
  }

  @Get('/runs/:runId/trace')
  @ApiOkResponse({
    description: 'Trace events for a workflow run',
    schema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              nodeRef: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              message: { type: 'string' },
              error: { type: 'string' },
              outputSummary: { type: 'object' },
            },
            additionalProperties: false,
          },
        },
      },
    },
  })
  async trace(@Param('runId') runId: string) {
    return { runId, events: this.traceService.list(runId) };
  }

  @Get()
  async findAll() {
    return this.workflowsService.list();
  }
}
