import api, { route } from '@forge/api';
import type { McpToolDefinition, McpToolResult } from '../types';

// ── Typed argument interfaces ──────────────────────────────────────────

interface LookupUserArgs {
  query: string;
  maxResults?: number;
}

// ── Tool definitions ───────────────────────────────────────────────────

export const userTools: McpToolDefinition[] = [
  {
    name: 'lookupJiraAccountId',
    description: 'Find Jira user account IDs by name or email. Useful for assigning issues.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — name or email address' },
        maxResults: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },
];

// ── Handler ─────────────────────────────────────────────────────────────

export async function handleUserTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case 'lookupJiraAccountId': {
      const a = args as unknown as LookupUserArgs;
      const params = new URLSearchParams({
        query: a.query,
        maxResults: String(a.maxResults ?? 10),
      });
      const res = await api.asApp().requestJira(
        route`/rest/api/3/user/search?${params}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      const data = await res.json();
      return res.ok
        ? { content: [{ type: 'text', text: JSON.stringify(data) }] }
        : { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
