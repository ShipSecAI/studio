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
    listFindingAssessmentCandidates: ReturnType<typeof jest.fn>;
    getFinding: ReturnType<typeof jest.fn>;
    listFindingAssessments: ReturnType<typeof jest.fn>;
    recordFindingAssessment: ReturnType<typeof jest.fn>;
    listFindingLinks: ReturnType<typeof jest.fn>;
    recordFindingLink: ReturnType<typeof jest.fn>;
    listThreatStories: ReturnType<typeof jest.fn>;
    getThreatStory: ReturnType<typeof jest.fn>;
    recordThreatStory: ReturnType<typeof jest.fn>;
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
      listFindingAssessmentCandidates: jest.fn().mockResolvedValue({
        candidates: [
          {
            id: 'finding-1',
            sourceKind: 'prowler',
            scannerMessage: 'Firewall default-allow-ssh exposes SSH to the internet.',
            provider: 'gcp',
            projectId: 'shipsec',
          },
        ],
      }),
      getFinding: jest.fn().mockResolvedValue({
        id: 'finding-1',
        findingKey: 'code:repo:cwe-639:get-/api/invoices/:id',
        evidence: [{ id: 'evidence-1' }],
      }),
      listFindingAssessments: jest.fn().mockResolvedValue({
        assessments: [{ id: 'assessment-1', verdict: 'actionable' }],
      }),
      recordFindingAssessment: jest.fn().mockResolvedValue({
        id: 'assessment-1',
        verdict: 'actionable',
      }),
      listFindingLinks: jest.fn().mockResolvedValue({
        links: [{ id: 'link-1', relationshipType: 'same_root_cause' }],
      }),
      recordFindingLink: jest.fn().mockResolvedValue({
        id: 'link-1',
        relationshipType: 'same_root_cause',
      }),
      listThreatStories: jest.fn().mockResolvedValue({
        stories: [{ id: 'story-1', title: 'Public invoice exposure', findings: [] }],
      }),
      getThreatStory: jest.fn().mockResolvedValue({
        id: 'story-1',
        title: 'Public invoice exposure',
      }),
      recordThreatStory: jest.fn().mockResolvedValue({
        id: 'story-1',
        title: 'Public invoice exposure',
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
      assessmentVerdict: 'unassessed',
      userVisibleOnly: false,
      limit: 25,
      offset: 50,
    });

    expect(securityIngestionService.listFindings).toHaveBeenCalledWith('org-1', {
      sourceKind: 'ai_code_review',
      status: 'open',
      assessmentVerdict: 'unassessed',
      userVisibleOnly: false,
      limit: 25,
      offset: 50,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.findings[0].findingKey).toBe('code:repo:cwe-639:get-/api/invoices/:id');
  });

  it('lists compact finding assessment candidates for agentic noise reduction', async () => {
    const result = await tools['list_finding_assessment_candidates'].handler({
      sourceKind: 'prowler',
      status: 'open',
      assessmentVerdict: 'unassessed',
      limit: 25,
      offset: 100,
    });

    expect(securityIngestionService.listFindingAssessmentCandidates).toHaveBeenCalledWith('org-1', {
      sourceKind: 'prowler',
      status: 'open',
      assessmentVerdict: 'unassessed',
      limit: 25,
      offset: 100,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.candidates[0].scannerMessage).toContain('exposes SSH');
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

  it('lists agent assessments for a durable finding', async () => {
    const result = await tools['list_finding_assessments'].handler({
      findingId: 'finding-1',
    });

    expect(securityIngestionService.listFindingAssessments).toHaveBeenCalledWith(
      'org-1',
      'finding-1',
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.assessments[0].verdict).toBe('actionable');
  });

  it('records an agent assessment for a durable finding', async () => {
    const result = await tools['record_finding_assessment'].handler({
      findingId: 'finding-1',
      verdict: 'actionable',
      importance: 'high',
      confidence: 0.83,
      reasoningMarkdown: 'This maps to a product-owned endpoint.',
      evidenceRefs: ['evidence-1'],
      wikiRefs: ['wiki://runtime/workflows-agents-and-tools.md'],
      createdByAgentRunId: 'agent-run-1',
    });

    expect(securityIngestionService.recordFindingAssessment).toHaveBeenCalledWith('org-1', {
      findingId: 'finding-1',
      verdict: 'actionable',
      importance: 'high',
      confidence: 0.83,
      reasoningMarkdown: 'This maps to a product-owned endpoint.',
      evidenceRefs: ['evidence-1'],
      wikiRefs: ['wiki://runtime/workflows-agents-and-tools.md'],
      toolCallsSummary: undefined,
      createdByAgentRunId: 'agent-run-1',
      createdBy: 'user-1',
      metadata: undefined,
    });
    expect(result.isError).toBeUndefined();
  });

  it('lists links connected to a durable finding', async () => {
    const result = await tools['list_finding_links'].handler({
      findingId: 'finding-1',
    });

    expect(securityIngestionService.listFindingLinks).toHaveBeenCalledWith('org-1', 'finding-1');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.links[0].id).toBe('link-1');
  });

  it('records an evidence-backed finding link', async () => {
    const result = await tools['record_finding_link'].handler({
      fromFindingId: 'finding-1',
      toFindingId: 'finding-2',
      relationshipType: 'same_root_cause',
      confidence: 0.82,
      rationale: 'Both findings share the same missing tenant check.',
      evidenceRefs: ['evidence-1'],
      createdByAgentRunId: 'agent-run-1',
    });

    expect(securityIngestionService.recordFindingLink).toHaveBeenCalledWith('org-1', {
      fromFindingId: 'finding-1',
      toFindingId: 'finding-2',
      relationshipType: 'same_root_cause',
      confidence: 0.82,
      rationale: 'Both findings share the same missing tenant check.',
      evidenceRefs: ['evidence-1'],
      createdByAgentRunId: 'agent-run-1',
      createdBy: 'user-1',
      metadata: undefined,
    });
    expect(result.isError).toBeUndefined();
  });

  it('lists durable threat stories', async () => {
    const result = await tools['list_threat_stories'].handler({
      status: 'open',
      limit: 10,
    });

    expect(securityIngestionService.listThreatStories).toHaveBeenCalledWith('org-1', {
      status: 'open',
      limit: 10,
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.stories[0].id).toBe('story-1');
  });

  it('gets one durable threat story', async () => {
    const result = await tools['get_threat_story'].handler({
      storyId: 'story-1',
    });

    expect(securityIngestionService.getThreatStory).toHaveBeenCalledWith('org-1', 'story-1');
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.story.id).toBe('story-1');
  });

  it('records an agent-written threat story', async () => {
    const result = await tools['record_threat_story'].handler({
      title: 'Public invoice exposure',
      severity: 'high',
      summary: 'Invoice endpoint is public and misses tenant authorization.',
      impact: 'A customer can read another customer invoice.',
      findingIds: ['finding-1', 'finding-2'],
      findingRoles: { 'finding-1': 'root_cause' },
      findingRationales: { 'finding-1': 'Missing tenant predicate.' },
      evidenceRefs: ['evidence-1'],
      createdByAgentRunId: 'agent-run-1',
    });

    expect(securityIngestionService.recordThreatStory).toHaveBeenCalledWith('org-1', {
      title: 'Public invoice exposure',
      severity: 'high',
      summary: 'Invoice endpoint is public and misses tenant authorization.',
      impact: 'A customer can read another customer invoice.',
      findingIds: ['finding-1', 'finding-2'],
      findingRoles: { 'finding-1': 'root_cause' },
      findingRationales: { 'finding-1': 'Missing tenant predicate.' },
      evidenceRefs: ['evidence-1'],
      createdByAgentRunId: 'agent-run-1',
      createdBy: 'user-1',
    });
    expect(result.isError).toBeUndefined();
  });
});
