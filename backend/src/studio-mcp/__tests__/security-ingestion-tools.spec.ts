import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StudioMcpService } from '../studio-mcp.service';
import type { AuthContext } from '../../auth/types';

type RegisteredToolsMap = Record<string, any>;

function getRegisteredTools(server: McpServer): RegisteredToolsMap {
  return (server as unknown as { _registeredTools: RegisteredToolsMap })._registeredTools;
}

describe('Security Ingestion MCP Tools', () => {
  const auth: AuthContext = {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  let securityIngestionService: {
    listFindingChains: ReturnType<typeof jest.fn>;
  };
  let tools: RegisteredToolsMap;

  beforeEach(() => {
    securityIngestionService = {
      listFindingChains: jest.fn().mockResolvedValue({
        findings: [
          {
            findingKey: 'code:repo:cwe-639:get-/api/invoices/:id',
            severity: 'high',
            status: 'open',
          },
        ],
      }),
    };

    const service = new StudioMcpService(
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      securityIngestionService as any,
    );

    tools = getRegisteredTools(service.createServer(auth));
  });

  it('lists durable finding chains from the official Studio MCP surface', async () => {
    const result = await tools['list_security_finding_chains'].handler({
      sourceKind: 'agent-code-review',
      status: 'open',
      limit: 25,
    });

    expect(securityIngestionService.listFindingChains).toHaveBeenCalledWith('org-1', {
      sourceKind: 'agent-code-review',
      status: 'open',
      limit: 25,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.findings[0].findingKey).toBe('code:repo:cwe-639:get-/api/invoices/:id');
  });
});
