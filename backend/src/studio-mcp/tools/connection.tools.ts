import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerConnectionTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { integrationsService } = deps;
  if (!integrationsService) return;

  server.registerTool(
    'list_connections',
    {
      description:
        'List all connected integrations (AWS accounts, GitHub repos, etc). ' +
        'Returns provider, display name, credential type, account info, and validation status.',
      inputSchema: {
        provider: z.string().optional().describe('Filter by provider (e.g. aws, github)'),
      },
    },
    async (params) => {
      const gate = checkPermission(auth, 'assets.list');
      if (!gate.allowed) return gate.error;
      try {
        const connections = await integrationsService.listConnectionsForOrg(auth, params.provider);
        const safe = connections.map((c: any) => ({
          id: c.id,
          provider: c.provider,
          displayName: c.displayName,
          credentialType: c.credentialType,
          accountId: c.metadata?.accountId ?? c.metadata?.account_id ?? null,
          region: c.metadata?.region ?? null,
          status: c.status ?? null,
          lastValidatedAt: c.lastValidatedAt,
          lastValidationStatus: c.lastValidationStatus ?? null,
          createdAt: c.createdAt,
        }));
        return jsonResult(safe);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
