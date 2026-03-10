import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AgentSkillsRepository } from './agent-skills.repository';
import type { AuthContext } from '../auth/types';
import { AuditLogService } from '../audit/audit-log.service';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';
import type {
  CreateAgentSkillDto,
  UpdateAgentSkillDto,
  AgentSkillResponse,
} from './dto/agent-skills.dto';
import type { AgentSkillRecord } from '../database/schema';

@Injectable()
export class AgentSkillsService {
  private readonly logger = new Logger(AgentSkillsService.name);

  constructor(
    private readonly repository: AgentSkillsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  private resolveOrganizationId(auth: AuthContext | null): string {
    return auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  }

  private assertOrganizationId(auth: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return organizationId;
  }

  private mapToResponse(record: AgentSkillRecord): AgentSkillResponse {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      content: record.content,
      license: record.license ?? null,
      compatibility: record.compatibility ?? null,
      metadata: record.metadata ?? null,
      allowedTools: record.allowedTools ?? null,
      isEnabled: record.isEnabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async listSkills(auth: AuthContext | null): Promise<AgentSkillResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const skills = await this.repository.list({ organizationId });
    return skills.map((s) => this.mapToResponse(s));
  }

  async listEnabledSkills(auth: AuthContext | null): Promise<AgentSkillResponse[]> {
    const organizationId = this.assertOrganizationId(auth);
    const skills = await this.repository.listEnabled({ organizationId });
    return skills.map((s) => this.mapToResponse(s));
  }

  async getSkill(auth: AuthContext | null, id: string): Promise<AgentSkillResponse> {
    const organizationId = this.assertOrganizationId(auth);
    const skill = await this.repository.findById(id, { organizationId });
    return this.mapToResponse(skill);
  }

  async createSkill(
    auth: AuthContext | null,
    input: CreateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    const organizationId = this.assertOrganizationId(auth);

    // Check for duplicate name within the organization
    const existing = await this.repository.list({ organizationId });
    const duplicate = existing.find((s) => s.name === input.name.trim());
    if (duplicate) {
      throw new BadRequestException(
        `An agent skill with the name "${input.name.trim()}" already exists. Please use a different name or delete the existing skill first.`,
      );
    }

    const skill = await this.repository.create({
      name: input.name.trim(),
      description: input.description.trim(),
      content: input.content,
      license: input.license ?? null,
      compatibility: input.compatibility ?? null,
      metadata: input.metadata ?? null,
      allowedTools: input.allowedTools ?? null,
      isEnabled: input.isEnabled ?? true,
      organizationId,
    });

    this.auditLogService.record(auth, {
      action: 'agent_skill.create',
      resourceType: 'agent_skill',
      resourceId: skill.id,
      resourceName: skill.name,
      metadata: {},
    });

    return this.mapToResponse(skill);
  }

  async updateSkill(
    auth: AuthContext | null,
    id: string,
    input: UpdateAgentSkillDto,
  ): Promise<AgentSkillResponse> {
    const organizationId = this.assertOrganizationId(auth);

    // Verify the skill exists and belongs to the organization
    const current = await this.repository.findById(id, { organizationId });

    const updates: Partial<{
      name: string;
      description: string;
      content: string;
      license: string | null;
      compatibility: string | null;
      metadata: Record<string, unknown> | null;
      allowedTools: string | null;
      isEnabled: boolean;
    }> = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Skill name cannot be empty');
      }
      updates.name = trimmed;
    }

    if (input.description !== undefined) {
      updates.description = input.description.trim();
    }

    if (input.content !== undefined) {
      updates.content = input.content;
    }

    if (input.license !== undefined) {
      updates.license = input.license ?? null;
    }

    if (input.compatibility !== undefined) {
      updates.compatibility = input.compatibility ?? null;
    }

    if (input.metadata !== undefined) {
      updates.metadata = input.metadata ?? null;
    }

    if (input.allowedTools !== undefined) {
      updates.allowedTools = input.allowedTools ?? null;
    }

    if (input.isEnabled !== undefined) {
      updates.isEnabled = input.isEnabled;
    }

    if (Object.keys(updates).length === 0) {
      return this.mapToResponse(current);
    }

    const skill = await this.repository.update(id, updates, { organizationId });

    this.auditLogService.record(auth, {
      action: 'agent_skill.update',
      resourceType: 'agent_skill',
      resourceId: skill.id,
      resourceName: skill.name,
      metadata: {},
    });

    return this.mapToResponse(skill);
  }

  async toggleSkill(auth: AuthContext | null, id: string): Promise<AgentSkillResponse> {
    const organizationId = this.assertOrganizationId(auth);
    const current = await this.repository.findById(id, { organizationId });
    const skill = await this.repository.update(
      id,
      { isEnabled: !current.isEnabled },
      { organizationId },
    );

    this.auditLogService.record(auth, {
      action: 'agent_skill.toggle',
      resourceType: 'agent_skill',
      resourceId: skill.id,
      resourceName: skill.name,
      metadata: { isEnabled: skill.isEnabled },
    });

    return this.mapToResponse(skill);
  }

  async deleteSkill(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = this.assertOrganizationId(auth);
    const skill = await this.repository.findById(id, { organizationId });
    await this.repository.delete(id, { organizationId });

    this.auditLogService.record(auth, {
      action: 'agent_skill.delete',
      resourceType: 'agent_skill',
      resourceId: skill.id,
      resourceName: skill.name,
      metadata: {},
    });
  }

  /**
   * Generate the full SKILL.md content from stored data.
   * Format:
   * ---
   * name: <name>
   * description: <description>
   * [allowed-tools: <tools>]
   * ---
   *
   * <content>
   */
  previewSkillMd(record: AgentSkillRecord): string {
    const frontmatterLines: string[] = [
      '---',
      `name: ${record.name}`,
      `description: ${record.description}`,
    ];

    if (record.allowedTools) {
      frontmatterLines.push(`allowed-tools: ${record.allowedTools}`);
    }

    frontmatterLines.push('---');

    return [...frontmatterLines, '', record.content].join('\n');
  }

  async getSkillPreview(auth: AuthContext | null, id: string): Promise<{ content: string }> {
    const organizationId = this.assertOrganizationId(auth);
    const skill = await this.repository.findById(id, { organizationId });
    return { content: this.previewSkillMd(skill) };
  }
}
