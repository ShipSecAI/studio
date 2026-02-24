import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerSecretTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { secretsService } = deps;

  server.registerTool(
    'list_secrets',
    {
      description:
        'List all secrets in the organization. Returns metadata only (id, name, description, tags, timestamps) — values are never exposed.',
    },
    async () => {
      const gate = checkPermission(auth, 'secrets.list');
      if (!gate.allowed) return gate.error;
      if (!secretsService) {
        return errorResult(new Error('Secrets service is not available'));
      }
      try {
        const secrets = await secretsService.listSecrets(auth);
        return jsonResult(secrets);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_secret',
    {
      description: 'Create a new secret. The value is stored encrypted and never returned.',
      inputSchema: {
        name: z.string().describe('Name of the secret'),
        value: z.string().describe('Secret value to store encrypted'),
        description: z.string().optional().describe('Optional description'),
        tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
      },
    },
    async (args: { name: string; value: string; description?: string; tags?: string[] }) => {
      const gate = checkPermission(auth, 'secrets.create');
      if (!gate.allowed) return gate.error;
      if (!secretsService) {
        return errorResult(new Error('Secrets service is not available'));
      }
      try {
        const result = await secretsService.createSecret(auth, {
          name: args.name,
          value: args.value,
          description: args.description,
          tags: args.tags,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'rotate_secret',
    {
      description:
        'Rotate a secret to a new value, creating a new version. The previous version is retained per retention policy.',
      inputSchema: {
        secretId: z.string().describe('ID of the secret to rotate'),
        value: z.string().describe('New secret value'),
      },
    },
    async (args: { secretId: string; value: string }) => {
      const gate = checkPermission(auth, 'secrets.update');
      if (!gate.allowed) return gate.error;
      if (!secretsService) {
        return errorResult(new Error('Secrets service is not available'));
      }
      try {
        const result = await secretsService.rotateSecret(auth, args.secretId, {
          value: args.value,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_secret',
    {
      description:
        'Update secret metadata (name, description, tags). Does not change the secret value — use rotate_secret for that.',
      inputSchema: {
        secretId: z.string().describe('ID of the secret to update'),
        name: z.string().optional().describe('New name for the secret'),
        description: z.string().optional().describe('New description'),
        tags: z.array(z.string()).optional().describe('New tags (replaces existing tags)'),
      },
    },
    async (args: { secretId: string; name?: string; description?: string; tags?: string[] }) => {
      const gate = checkPermission(auth, 'secrets.update');
      if (!gate.allowed) return gate.error;
      if (!secretsService) {
        return errorResult(new Error('Secrets service is not available'));
      }
      try {
        const result = await secretsService.updateSecret(auth, args.secretId, {
          name: args.name,
          description: args.description,
          tags: args.tags,
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_secret',
    {
      description: 'Permanently delete a secret and all its versions.',
      inputSchema: {
        secretId: z.string().describe('ID of the secret to delete'),
      },
    },
    async (args: { secretId: string }) => {
      const gate = checkPermission(auth, 'secrets.delete');
      if (!gate.allowed) return gate.error;
      if (!secretsService) {
        return errorResult(new Error('Secrets service is not available'));
      }
      try {
        await secretsService.deleteSecret(auth, args.secretId);
        return jsonResult({ deleted: true, secretId: args.secretId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
