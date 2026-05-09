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
    listFindings: ReturnType<typeof jest.fn>;
    getFinding: ReturnType<typeof jest.fn>;
  };
  let tools: RegisteredToolsMap;

  beforeEach(() => {
    securityIngestionService = {
      listFindings: jest.fn().mockResolvedValue({
        findings: [
          {
            id: 'finding-1',
            findingKey: 'code:repo:cwe-639:get-/api/invoices/:id',
            severity: 'high',
            status: 'open',
          },
        ],
      }),
      getFinding: jest.fn().mockResolvedValue({
        id: 'finding-1',
        findingKey: 'code:repo:cwe-639:get-/api/invoices/:id',
        evidence: [{ id: 'evidence-1' }],
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

  it('lists durable findings from the official Studio MCP surface', async () => {
    const result = await tools['list_security_findings'].handler({
      sourceKind: 'ai_code_review',
      status: 'open',
      limit: 25,
    });

    expect(securityIngestionService.listFindings).toHaveBeenCalledWith('org-1', {
      sourceKind: 'ai_code_review',
      status: 'open',
      limit: 25,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.findings[0].findingKey).toBe('code:repo:cwe-639:get-/api/invoices/:id');
  });

  it('gets one durable finding from the official Studio MCP surface', async () => {
    const result = await tools['get_security_finding'].handler({
      findingId: 'finding-1',
    });

    expect(securityIngestionService.getFinding).toHaveBeenCalledWith('org-1', 'finding-1');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.finding.id).toBe('finding-1');
    expect(parsed.finding.evidence[0].id).toBe('evidence-1');
  });
});
