import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerHumanInputTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { humanInputsService } = deps;

  server.registerTool(
    'list_human_inputs',
    {
      description:
        'List human input/approval requests for the organization. Filter by status to find pending items that need attention.',
      inputSchema: {
        status: z
          .enum(['pending', 'resolved', 'expired'])
          .optional()
          .describe('Filter by status. Omit to return all.'),
      },
    },
    async (args: { status?: 'pending' | 'resolved' | 'expired' }) => {
      const gate = checkPermission(auth, 'human-inputs.read');
      if (!gate.allowed) return gate.error;
      if (!humanInputsService) {
        return errorResult(new Error('Human inputs service is not available'));
      }
      try {
        const inputs = await humanInputsService.list(
          { status: args.status },
          auth.organizationId ?? undefined,
        );
        return jsonResult(inputs);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_human_input',
    {
      description: 'Get full details of a specific human input or approval request.',
      inputSchema: {
        inputId: z.string().describe('ID of the human input request'),
      },
    },
    async (args: { inputId: string }) => {
      const gate = checkPermission(auth, 'human-inputs.read');
      if (!gate.allowed) return gate.error;
      if (!humanInputsService) {
        return errorResult(new Error('Human inputs service is not available'));
      }
      try {
        const input = await humanInputsService.getById(
          args.inputId,
          auth.organizationId ?? undefined,
        );
        return jsonResult(input);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'resolve_human_input',
    {
      description:
        'Resolve a pending human input request by approving or rejecting it, optionally providing additional data.',
      inputSchema: {
        inputId: z.string().describe('ID of the human input request to resolve'),
        action: z.enum(['approve', 'reject']).describe('Resolution action'),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional additional data to include with the resolution'),
      },
    },
    async (args: {
      inputId: string;
      action: 'approve' | 'reject';
      data?: Record<string, unknown>;
    }) => {
      const gate = checkPermission(auth, 'human-inputs.resolve');
      if (!gate.allowed) return gate.error;
      if (!humanInputsService) {
        return errorResult(new Error('Human inputs service is not available'));
      }
      try {
        const result = await humanInputsService.resolve(
          args.inputId,
          {
            responseData: {
              status: args.action === 'reject' ? 'rejected' : 'approved',
              ...args.data,
            },
            respondedBy: auth.userId ?? undefined,
          },
          auth.organizationId ?? undefined,
          auth,
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
