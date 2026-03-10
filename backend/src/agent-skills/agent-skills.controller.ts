import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';

import { AgentSkillsService } from './agent-skills.service';
import {
  CreateAgentSkillDto,
  UpdateAgentSkillDto,
  AgentSkillResponse,
} from './dto/agent-skills.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('agent-skills')
@Controller('agent-skills')
export class AgentSkillsController {
  constructor(private readonly agentSkillsService: AgentSkillsService) {}

  @Get()
  @ApiOperation({ summary: 'List all agent skills' })
  @ApiOkResponse({ type: [AgentSkillResponse] })
  async listSkills(@CurrentAuth() auth: AuthContext | null): Promise<AgentSkillResponse[]> {
    return this.agentSkillsService.listSkills(auth);
  }

  @Get('enabled')
  @ApiOperation({ summary: 'List enabled agent skills only' })
  @ApiOkResponse({ type: [AgentSkillResponse] })
  async listEnabledSkills(@CurrentAuth() auth: AuthContext | null): Promise<AgentSkillResponse[]> {
    return this.agentSkillsService.listEnabledSkills(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific agent skill' })
  @ApiOkResponse({ type: AgentSkillResponse })
  async getSkill(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.getSkill(auth, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new agent skill' })
  @ApiCreatedResponse({ type: AgentSkillResponse })
  async createSkill(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.createSkill(auth, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an agent skill' })
  @ApiOkResponse({ type: AgentSkillResponse })
  async updateSkill(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.updateSkill(auth, id, body);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Toggle agent skill enabled/disabled status' })
  @ApiOkResponse({ type: AgentSkillResponse })
  async toggleSkill(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AgentSkillResponse> {
    return this.agentSkillsService.toggleSkill(auth, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent skill' })
  @ApiNoContentResponse()
  async deleteSkill(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.agentSkillsService.deleteSkill(auth, id);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Preview the SKILL.md content for an agent skill' })
  @ApiOkResponse({ schema: { type: 'object', properties: { content: { type: 'string' } } } })
  async previewSkillMd(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ content: string }> {
    return this.agentSkillsService.getSkillPreview(auth, id);
  }
}
