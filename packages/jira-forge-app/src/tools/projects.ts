import api, { route } from '@forge/api';
import type { McpToolDefinition, McpToolResult } from '../types';

// ── Typed argument interfaces ──────────────────────────────────────────

interface ListProjectsArgs {
  maxResults?: number;
  startAt?: number;
  query?: string;
}

interface ProjectIssueTypesArgs {
  projectIdOrKey: string;
}

interface IssueTypeFieldsArgs {
  projectIdOrKey: string;
  issueTypeId: string;
}

// ── Tool definitions ───────────────────────────────────────────────────

export const projectTools: McpToolDefinition[] = [
  {
    name: 'getVisibleJiraProjects',
    description: 'List Jira projects visible to the app.',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max results (default: 50)' },
        startAt: { type: 'number', description: 'Pagination offset (default: 0)' },
        query: { type: 'string', description: 'Filter projects by name' },
      },
    },
  },
  {
    name: 'getJiraProjectIssueTypesMetadata',
    description: 'List issue types available in a Jira project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectIdOrKey: { type: 'string', description: 'Project ID or key' },
      },
      required: ['projectIdOrKey'],
    },
  },
  {
    name: 'getJiraIssueTypeMetaWithFields',
    description: 'Get field metadata for creating an issue of a specific type in a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectIdOrKey: { type: 'string', description: 'Project ID or key' },
        issueTypeId: { type: 'string', description: 'Issue type ID' },
      },
      required: ['projectIdOrKey', 'issueTypeId'],
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function err(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
}

async function parseResponse(res: { ok: boolean; json: () => Promise<unknown> }): Promise<McpToolResult> {
  const data = await res.json();
  return res.ok ? ok(data) : err(data);
}

// ── Handler ─────────────────────────────────────────────────────────────

export async function handleProjectTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case 'getVisibleJiraProjects': {
      const a = args as unknown as ListProjectsArgs;
      const params = new URLSearchParams();
      if (a.maxResults != null) params.set('maxResults', String(a.maxResults));
      if (a.startAt != null) params.set('startAt', String(a.startAt));
      if (a.query) params.set('query', a.query);

      const res = await api.asApp().requestJira(
        route`/rest/api/3/project/search?${params}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    case 'getJiraProjectIssueTypesMetadata': {
      const a = args as unknown as ProjectIssueTypesArgs;
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/createmeta/${a.projectIdOrKey}/issuetypes`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    case 'getJiraIssueTypeMetaWithFields': {
      const a = args as unknown as IssueTypeFieldsArgs;
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/createmeta/${a.projectIdOrKey}/issuetypes/${a.issueTypeId}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
