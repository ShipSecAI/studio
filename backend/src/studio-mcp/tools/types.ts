import { Logger } from '@nestjs/common';
import type { AuthContext, ApiKeyPermissions } from '../../auth/types';
import type { WorkflowsService } from '../../workflows/workflows.service';

export type PermissionPath =
  | 'workflows.list'
  | 'workflows.read'
  | 'workflows.create'
  | 'workflows.update'
  | 'workflows.delete'
  | 'workflows.run'
  | 'runs.read'
  | 'runs.cancel'
  | 'artifacts.read'
  | 'artifacts.delete'
  | 'secrets.list'
  | 'secrets.read'
  | 'secrets.create'
  | 'secrets.update'
  | 'secrets.delete'
  | 'schedules.list'
  | 'schedules.read'
  | 'schedules.create'
  | 'schedules.update'
  | 'schedules.delete'
  | 'human-inputs.read'
  | 'human-inputs.resolve';

export interface ToolResult {
  content: [{ type: 'text'; text: string }, ...{ type: 'text'; text: string }[]];
  isError?: boolean;
}

export interface StudioMcpDeps {
  workflowsService: WorkflowsService;
}

const logger = new Logger('StudioMcpTools');

/**
 * Check whether the caller's API key permits the given action.
 * Non-API-key callers (e.g. internal service tokens) are always allowed.
 */
export function checkPermission(
  auth: AuthContext,
  permission: PermissionPath,
):
  | { allowed: true }
  | { allowed: false; error: { content: { type: 'text'; text: string }[]; isError: true } } {
  const perms = auth.apiKeyPermissions;
  if (!perms) return { allowed: true }; // non-API-key auth → unrestricted

  const [scope, action] = permission.split('.') as [keyof ApiKeyPermissions, string];
  const scopePerms = perms[scope] as Record<string, boolean> | undefined;
  if (!scopePerms || !scopePerms[action]) {
    return {
      allowed: false,
      error: {
        content: [
          {
            type: 'text' as const,
            text: `Permission denied: API key lacks '${permission}' permission.`,
          },
        ],
        isError: true,
      },
    };
  }
  return { allowed: true };
}

export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Studio MCP tool error: ${message}`);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}
