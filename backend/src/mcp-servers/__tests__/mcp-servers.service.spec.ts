import { describe, expect, it, mock } from 'bun:test';

import { McpServersService } from '../mcp-servers.service';

function createServerRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'server-1',
    name: 'GitHub MCP',
    description: 'Official GitHub MCP server using your connected GitHub App installation.',
    transportType: 'stdio',
    endpoint: null,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    headers: null,
    enabled: true,
    healthCheckUrl: null,
    lastHealthCheck: null,
    lastHealthStatus: null,
    groupId: null,
    templateSlug: 'github',
    templateHash: 'hash-1',
    templateConfig: {
      installationId: 123,
      readOnly: false,
      toolsets: ['context', 'repos'],
      dynamicToolsets: false,
    },
    organizationId: 'org-1',
    createdBy: 'user-1',
    createdAt: new Date('2026-04-06T00:00:00.000Z'),
    updatedAt: new Date('2026-04-06T00:00:00.000Z'),
    ...overrides,
  } as any;
}

describe('McpServersService.importTemplate', () => {
  it('runs discovery after importing a curated MCP server and returns refreshed health', async () => {
    const createdServer = createServerRecord();
    const refreshedServer = createServerRecord({
      lastHealthStatus: 'healthy',
      lastHealthCheck: new Date('2026-04-06T00:00:05.000Z'),
    });

    const repository = {
      findByTemplateSlug: mock(async () => null),
      create: mock(async () => createdServer),
      findById: mock(async () => refreshedServer),
    };

    const auditLogService = {
      record: mock(() => {}),
    };

    const service = new McpServersService(
      repository as any,
      {} as any,
      {} as any,
      {
        listInstallations: mock(async () => [{ installationId: 123 }]),
      } as any,
      null,
      null,
      auditLogService as any,
    );

    const testServerConnection = mock(async () => ({
      success: true,
      message: 'Connection successful (26 tools discovered)',
      toolCount: 26,
    }));
    (service as any).testServerConnection = testServerConnection;

    const result = await service.importTemplate(
      { organizationId: 'org-1', userId: 'user-1' } as any,
      'github',
      {
        github: {
          installationId: 123,
          readOnly: false,
          toolsets: ['context', 'repos'],
        },
      } as any,
    );

    expect(repository.create).toHaveBeenCalled();
    expect(testServerConnection).toHaveBeenCalledWith(
      { organizationId: 'org-1', userId: 'user-1' },
      createdServer.id,
    );
    expect(repository.findById).toHaveBeenLastCalledWith(createdServer.id, {
      organizationId: 'org-1',
    });
    expect(result.action).toBe('created');
    expect(result.server.lastHealthStatus).toBe('healthy');
  });
});
