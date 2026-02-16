import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type { WorkflowGraphDto } from '../workflows/dto/workflow-graph.dto';

@ApiTags('workflow-templates')
@Controller('workflow-templates')
@UseGuards(AuthGuard, RolesGuard)
export class WorkflowTemplatesController {
  constructor(
    private readonly templatesService: WorkflowTemplatesService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  @Get()
  async list() {
    return this.templatesService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.templatesService.getById(id);
  }

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      description?: string;
      category: string;
      graph: unknown;
      icon?: string;
      isDefault?: boolean;
    },
  ) {
    return this.templatesService.create({
      name: body.name,
      description: body.description,
      category: body.category as
        | 'code-security'
        | 'cloud-security'
        | 'attack-surface'
        | 'notification',
      graph: body.graph,
      icon: body.icon,
      isDefault: body.isDefault ?? false,
    });
  }

  @Post(':id/instantiate')
  @ApiOkResponse({ description: 'Creates a new workflow from the template' })
  async instantiate(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: { name?: string } | undefined,
  ) {
    const template = await this.templatesService.getById(id);
    const graph = template.graph as {
      nodes: unknown[];
      edges: unknown[];
      name?: string;
      description?: string;
    };

    const workflowName = body?.name ?? template.name;
    const workflowGraph = {
      ...graph,
      name: workflowName,
      description: template.description ?? graph.description ?? '',
    };

    const workflow = await this.workflowsService.create(
      workflowGraph as unknown as WorkflowGraphDto,
      auth,
    );
    return workflow;
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.templatesService.delete(id);
    return { success: true };
  }
}
