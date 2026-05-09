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
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .default(50)
          .describe('Maximum number of findings to return, from 1 to 200.'),
      },
    },
    async (args: { sourceKind?: string; status?: string; limit?: number }) => {
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
          limit: args.limit,
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
}
