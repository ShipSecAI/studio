import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { McpGroupsController } from '../mcp-groups.controller';
import { McpGroupsService } from '../mcp-groups.service';
import type { AuthContext } from '../../auth/types';
import type { ImportTemplateRequestDto } from '../dto/mcp-groups.dto';

function makeService() {
  return {
    importTemplate: jest.fn().mockResolvedValue({ action: 'created', group: { id: 'g1' } }),
    listGroups: jest.fn().mockResolvedValue([]),
    listGroupsWithServers: jest.fn().mockResolvedValue([]),
    listTemplates: jest.fn().mockReturnValue([]),
    getGroup: jest.fn(),
    getGroupBySlug: jest.fn(),
    createGroup: jest.fn(),
    updateGroup: jest.fn(),
    deleteGroup: jest.fn(),
    getServersInGroup: jest.fn().mockResolvedValue([]),
    addServerToGroup: jest.fn(),
    removeServerFromGroup: jest.fn(),
    updateServerInGroup: jest.fn(),
    syncTemplates: jest.fn(),
  } as unknown as McpGroupsService;
}

const AUTH_WITH_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-123',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_NO_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

describe('McpGroupsController.importTemplate', () => {
  let controller: McpGroupsController;
  let service: McpGroupsService;

  beforeEach(() => {
    service = makeService();
    controller = new McpGroupsController(service);
  });

  it('throws UnauthorizedException when auth is null', async () => {
    await expect(
      controller.importTemplate(null, 'some-slug', {} as ImportTemplateRequestDto),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.importTemplate).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when organizationId is null', async () => {
    await expect(
      controller.importTemplate(AUTH_NO_ORG, 'some-slug', {} as ImportTemplateRequestDto),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.importTemplate).not.toHaveBeenCalled();
  });

  it('passes organizationId to the service when auth context is valid', async () => {
    const body: ImportTemplateRequestDto = { serverCacheTokens: {} };
    await controller.importTemplate(AUTH_WITH_ORG, 'my-template', body);

    expect(service.importTemplate).toHaveBeenCalledWith('my-template', 'org-123', body);
  });
});
