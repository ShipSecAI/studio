import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

const findingLinkRelationshipSchema = z.enum([
  'duplicate_of',
  'same_root_cause',
  'enables',
  'contradicts',
  'same_asset',
  'same_control',
  'mitigated_by',
  'related',
]);

const findingAssessmentVerdictSchema = z.enum([
  'actionable',
  'not_relevant',
  'false_positive',
  'accepted_risk',
  'needs_context',
  'resolved_candidate',
]);

const findingAssessmentImportanceSchema = z.enum(['critical', 'high', 'medium', 'low', 'noise']);

const threatStoryRecordSchema = {
  storyKey: z.string().min(1).optional(),
  title: z.string().min(1),
  status: z.string().min(1).optional(),
  severity: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().min(1),
  impact: z.string().min(1),
  attackPath: z.string().optional(),
  recommendedAction: z.string().optional(),
  findingIds: z.array(z.string().min(1)).min(1),
  findingRoles: z.record(z.string(), z.string()).optional(),
  findingRationales: z.record(z.string(), z.string()).optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  affectedAssetRefs: z.array(z.string().min(1)).optional(),
  createdByAgentRunId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

export function registerSecurityIngestionTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { securityIngestionService } = deps;

  server.registerTool(
    'list_security_findings',
    {
      description:
        'List durable ShipSec security findings with their latest observation, source run lineage, asset, observations, and evidence. ' +
        'Use this when an agent needs canonical product findings to correlate scanner, cloud, code, and attack-surface evidence into linked threats.',
      inputSchema: {
        sourceKind: z
          .string()
          .optional()
          .describe('Optional source kind filter, for example prowler, asm, or ai_code_review.'),
        status: z
          .string()
          .optional()
          .describe('Optional finding status filter, for example open or resolved.'),
        assessmentVerdict: z
          .string()
          .optional()
          .describe(
            'Optional latest agent assessment verdict filter. Use "unassessed" to find findings no agent has assessed yet.',
          ),
        userVisibleOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe('When true, only return findings whose latest agent verdict is user-visible.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(50)
          .describe('Maximum number of findings to return, from 1 to 200.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe('Number of findings to skip for pagination. Use with limit <= 200.'),
      },
    },
    async (args: {
      sourceKind?: string;
      status?: string;
      assessmentVerdict?: string;
      userVisibleOnly?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const result = await securityIngestionService.listFindings(auth.organizationId, {
          sourceKind: args.sourceKind?.trim() || undefined,
          status: args.status?.trim() || undefined,
          assessmentVerdict: args.assessmentVerdict?.trim() || undefined,
          userVisibleOnly: args.userVisibleOnly,
          limit: args.limit,
          offset: args.offset,
        });

        return jsonResult({
          count: result.findings.length,
          findings: result.findings,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_finding_assessment_candidates',
    {
      description:
        'List compact finding-assessment candidates designed for agentic noise reduction. ' +
        'This returns one row per durable finding with scanner rule/status/message/provider/resource fields, evidence refs, latest assessment, and a stack-relevance checklist. ' +
        'Use this before record_finding_assessment so the agent can decide whether scanner output is product-relevant, noise, false-positive, needs-context, or actionable without parsing giant raw scanner blobs.',
      inputSchema: {
        sourceKind: z
          .string()
          .optional()
          .describe('Optional source kind filter, for example prowler or ai_code_review.'),
        status: z
          .string()
          .optional()
          .describe('Optional finding status filter, for example open or resolved.'),
        assessmentVerdict: z
          .string()
          .optional()
          .describe(
            'Optional latest agent assessment verdict filter. Use "unassessed" to find findings no agent has assessed yet.',
          ),
        limit: z.number().int().min(1).max(200).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
      },
    },
    async (args: {
      sourceKind?: string;
      status?: string;
      assessmentVerdict?: string;
      limit?: number;
      offset?: number;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService?.listFindingAssessmentCandidates) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const result = await securityIngestionService.listFindingAssessmentCandidates(
          auth.organizationId,
          {
            sourceKind: args.sourceKind?.trim() || undefined,
            status: args.status?.trim() || undefined,
            assessmentVerdict: args.assessmentVerdict?.trim() || undefined,
            limit: args.limit,
            offset: args.offset,
          },
        );

        return jsonResult({
          count: result.candidates.length,
          candidates: result.candidates,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_security_finding',
    {
      description:
        'Get one durable ShipSec security finding with observations, evidence, asset context, and source run lineage.',
      inputSchema: {
        findingId: z.string().min(1).describe('The durable security finding ID.'),
      },
    },
    async (args: { findingId: string }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const finding = await securityIngestionService.getFinding(
          auth.organizationId,
          args.findingId,
        );
        if (!finding) return errorResult(new Error('Finding not found'));
        return jsonResult({ finding });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_finding_assessments',
    {
      description:
        'List the append-only agent assessment notes for a durable finding. Use this before changing a verdict so the new reasoning accounts for prior agent decisions.',
      inputSchema: {
        findingId: z.string().min(1).describe('The durable security finding ID.'),
      },
    },
    async (args: { findingId: string }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const result = await securityIngestionService.listFindingAssessments(
          auth.organizationId,
          args.findingId,
        );
        if (!result) return errorResult(new Error('Finding not found'));
        return jsonResult({ count: result.assessments.length, assessments: result.assessments });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'record_finding_assessment',
    {
      description:
        'Append an agent assessment note for a durable finding. This is the canonical way to mark scanner output actionable, noisy, irrelevant, accepted risk, needs context, or resolved-candidate after reading ShipSec findings, wiki, and inventory context.',
      inputSchema: {
        findingId: z.string().min(1),
        verdict: findingAssessmentVerdictSchema,
        importance: findingAssessmentImportanceSchema,
        confidence: z.number().min(0).max(1).optional(),
        reasoningMarkdown: z.string().min(1),
        evidenceRefs: z.array(z.string().min(1)).optional(),
        wikiRefs: z.array(z.string().min(1)).optional(),
        toolCallsSummary: z.record(z.string(), z.unknown()).optional(),
        createdByAgentRunId: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args: {
      findingId: string;
      verdict: string;
      importance: string;
      confidence?: number;
      reasoningMarkdown: string;
      evidenceRefs?: string[];
      wikiRefs?: string[];
      toolCallsSummary?: Record<string, unknown>;
      createdByAgentRunId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const assessment = await securityIngestionService.recordFindingAssessment(
          auth.organizationId,
          {
            findingId: args.findingId,
            verdict: args.verdict,
            importance: args.importance,
            confidence: args.confidence,
            reasoningMarkdown: args.reasoningMarkdown,
            evidenceRefs: args.evidenceRefs,
            wikiRefs: args.wikiRefs,
            toolCallsSummary: args.toolCallsSummary,
            createdByAgentRunId: args.createdByAgentRunId,
            createdBy: auth.userId,
            metadata: args.metadata,
          },
        );
        return jsonResult({ assessment });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_finding_links',
    {
      description: 'List evidence-backed relationships connected to a durable security finding.',
      inputSchema: {
        findingId: z.string().min(1).describe('The durable security finding ID.'),
      },
    },
    async (args: { findingId: string }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const result = await securityIngestionService.listFindingLinks(
          auth.organizationId,
          args.findingId,
        );
        if (!result) return errorResult(new Error('Finding not found'));
        return jsonResult({ count: result.links.length, links: result.links });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'record_finding_link',
    {
      description:
        'Record a typed, evidence-backed relationship between two durable security findings.',
      inputSchema: {
        fromFindingId: z.string().min(1),
        toFindingId: z.string().min(1),
        relationshipType: findingLinkRelationshipSchema,
        confidence: z.number().min(0).max(1).optional(),
        rationale: z.string().min(1),
        evidenceRefs: z.array(z.string().min(1)).optional(),
        createdByAgentRunId: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args: {
      fromFindingId: string;
      toFindingId: string;
      relationshipType: string;
      confidence?: number;
      rationale: string;
      evidenceRefs?: string[];
      createdByAgentRunId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const link = await securityIngestionService.recordFindingLink(auth.organizationId, {
          fromFindingId: args.fromFindingId,
          toFindingId: args.toFindingId,
          relationshipType: args.relationshipType,
          confidence: args.confidence,
          rationale: args.rationale,
          evidenceRefs: args.evidenceRefs,
          createdByAgentRunId: args.createdByAgentRunId,
          createdBy: auth.userId,
          metadata: args.metadata,
        });
        return jsonResult({ link });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_threat_stories',
    {
      description:
        'List durable agent-written threat stories that group multiple findings into concrete attack or impact narratives.',
      inputSchema: {
        status: z.string().optional().describe('Optional threat story status filter.'),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
    },
    async (args: { status?: string; limit?: number }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const result = await securityIngestionService.listThreatStories(auth.organizationId, {
          status: args.status?.trim() || undefined,
          limit: args.limit,
        });
        return jsonResult({ count: result.stories.length, stories: result.stories });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_threat_story',
    {
      description:
        'Get one durable threat story with the findings it depends on, impact, evidence refs, and remediation narrative.',
      inputSchema: {
        storyId: z.string().min(1).describe('The durable threat story ID.'),
      },
    },
    async (args: { storyId: string }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const story = await securityIngestionService.getThreatStory(
          auth.organizationId,
          args.storyId,
        );
        if (!story) return errorResult(new Error('Threat story not found'));
        return jsonResult({ story });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'record_threat_story',
    {
      description:
        'Record an agent-written threat story over one or more durable findings. Use this after reasoning across findings, links, code, cloud, and wiki evidence.',
      inputSchema: threatStoryRecordSchema,
    },
    async (args: {
      storyKey?: string;
      title: string;
      status?: string;
      severity: string;
      confidence?: number;
      summary: string;
      impact: string;
      attackPath?: string;
      recommendedAction?: string;
      findingIds: string[];
      findingRoles?: Record<string, string>;
      findingRationales?: Record<string, string>;
      evidenceRefs?: string[];
      affectedAssetRefs?: string[];
      createdByAgentRunId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const gate = checkPermission(auth, 'analytics.query');
      if (!gate.allowed) return gate.error;
      if (!securityIngestionService) {
        return errorResult(new Error('Security ingestion service is not available'));
      }
      if (!auth.organizationId) {
        return errorResult(new Error('Organization context is required'));
      }

      try {
        const story = await securityIngestionService.recordThreatStory(auth.organizationId, {
          ...args,
          createdBy: auth.userId,
        });
        return jsonResult({ story });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
