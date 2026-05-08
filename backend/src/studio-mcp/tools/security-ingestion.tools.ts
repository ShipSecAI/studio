import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerSecurityIngestionTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { securityIngestionService } = deps;

  server.registerTool(
    'list_security_finding_chains',
    {
      description:
        'List durable ShipSec security finding chains with their latest observation, source run lineage, asset, observations, and evidence. ' +
        'Use this when an agent needs canonical product findings to correlate scanner, cloud, code, and attack-surface evidence into linked threats.',
      inputSchema: {
        sourceKind: z
          .string()
          .optional()
          .describe('Optional source kind filter, for example prowler, asm, or agent-code-review.'),
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
          .describe('Maximum number of finding chains to return, from 1 to 200.'),
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
        const result = await securityIngestionService.listFindingChains(auth.organizationId, {
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
}
