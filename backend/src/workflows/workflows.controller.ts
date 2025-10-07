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
import { ZodValidationPipe } from 'nestjs-zod';

import {
  CreateWorkflowRequestDto,
  UpdateWorkflowRequestDto,
  WorkflowGraphDto,
  WorkflowGraphSchema,
} from './dto/workflow-graph.dto';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

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

  @Get()
  async findAll() {
    return this.workflowsService.list();
  }
}
