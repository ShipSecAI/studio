import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowGraphSchema, WorkflowResponseDto } from '../workflows/dto/workflow-graph.dto';
import {
  CreateWorkflowTemplateRequestDto,
  DeleteWorkflowTemplateResponseDto,
  InstantiateWorkflowTemplateRequestDto,
  WorkflowTemplateResponseDto,
} from './dto/workflow-template.dto';

@ApiTags('workflow-templates')
@Controller('workflow-templates')
@UseGuards(AuthGuard, RolesGuard)
export class WorkflowTemplatesController {
  constructor(
    private readonly templatesService: WorkflowTemplatesService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [WorkflowTemplateResponseDto] })
  async list() {
    return this.templatesService.list();
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowTemplateResponseDto })
  async getById(@Param('id') id: string) {
    return this.templatesService.getById(id);
  }

  @Post()
  @ApiOkResponse({ type: WorkflowTemplateResponseDto })
  async create(@Body() body: CreateWorkflowTemplateRequestDto) {
    return this.templatesService.create({
      name: body.name,
      description: body.description,
      category: body.category,
      graph: body.graph,
      icon: body.icon,
      isDefault: body.isDefault ?? false,
    });
  }

  @Post(':id/instantiate')
  @ApiOkResponse({
    description: 'Creates a new workflow from the template',
    type: WorkflowResponseDto,
  })
  async instantiate(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: InstantiateWorkflowTemplateRequestDto | undefined,
  ) {
    const template = await this.templatesService.getById(id);
    const graph = WorkflowGraphSchema.parse(template.graph);

    const workflowName = body?.name ?? template.name;
    const workflowGraph = {
      ...graph,
      name: workflowName,
      description: template.description ?? graph.description ?? '',
    };

    const workflow = await this.workflowsService.create(workflowGraph, auth);
    return workflow;
  }

  @Delete(':id')
  @ApiOkResponse({ type: DeleteWorkflowTemplateResponseDto })
  async delete(@Param('id') id: string) {
    await this.templatesService.delete(id);
    return { success: true };
  }
}
