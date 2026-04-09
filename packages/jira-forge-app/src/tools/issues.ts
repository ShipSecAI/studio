import api, { route } from '@forge/api';
import type { McpToolDefinition, McpToolResult } from '../types';

// ── Typed argument interfaces ──────────────────────────────────────────

interface CreateIssueArgs {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  assigneeAccountId?: string;
  labels?: string[];
  priority?: string;
  components?: string[];
  additionalFields?: Record<string, unknown>;
}

interface EditIssueArgs {
  issueIdOrKey: string;
  summary?: string;
  description?: string;
  assigneeAccountId?: string;
  labels?: string[];
  priority?: string;
  additionalFields?: Record<string, unknown>;
}

interface GetIssueArgs {
  issueIdOrKey: string;
  fields?: string[];
}

interface SearchIssuesArgs {
  jql: string;
  maxResults?: number;
  startAt?: number;
  fields?: string[];
}

interface TransitionIssueArgs {
  issueIdOrKey: string;
  transitionId: string;
  comment?: string;
}

interface IssueKeyArgs {
  issueIdOrKey: string;
}

interface AddCommentArgs {
  issueIdOrKey: string;
  body: string;
}

interface BulkCreateArgs {
  issues: Array<{
    projectKey: string;
    issueType: string;
    summary: string;
    description?: string;
    assigneeAccountId?: string;
    labels?: string[];
    priority?: string;
  }>;
}

// ── Tool definitions ───────────────────────────────────────────────────

export const issueTools: McpToolDefinition[] = [
  {
    name: 'createJiraIssue',
    description: 'Create a new Jira issue. Returns the created issue key and ID.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string', description: 'Jira project key (e.g. "SEC")' },
        issueType: { type: 'string', description: 'Issue type name (e.g. "Bug", "Task", "Story")' },
        summary: { type: 'string', description: 'Issue summary/title' },
        description: { type: 'string', description: 'Issue description (plain text)' },
        assigneeAccountId: { type: 'string', description: 'Account ID of the assignee' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
        priority: { type: 'string', description: 'Priority name (e.g. "High", "Critical")' },
        components: { type: 'array', items: { type: 'string' }, description: 'Component names' },
        additionalFields: { type: 'object', description: 'Additional fields as key-value pairs' },
      },
      required: ['projectKey', 'issueType', 'summary'],
    },
  },
  {
    name: 'editJiraIssue',
    description: 'Update fields on an existing Jira issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueIdOrKey: { type: 'string', description: 'Issue ID or key (e.g. "SEC-123")' },
        summary: { type: 'string', description: 'New summary' },
        description: { type: 'string', description: 'New description' },
        assigneeAccountId: { type: 'string', description: 'New assignee account ID' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Replace labels' },
        priority: { type: 'string', description: 'New priority name' },
        additionalFields: { type: 'object', description: 'Additional fields to update' },
      },
      required: ['issueIdOrKey'],
    },
  },
  {
    name: 'getJiraIssue',
    description: 'Get full details of a Jira issue by its ID or key.',
    inputSchema: {
      type: 'object',
      properties: {
        issueIdOrKey: { type: 'string', description: 'Issue ID or key (e.g. "SEC-123")' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to return' },
      },
      required: ['issueIdOrKey'],
    },
  },
  {
    name: 'searchJiraIssuesUsingJql',
    description: 'Search for Jira issues using JQL (Jira Query Language).',
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'JQL query string' },
        maxResults: { type: 'number', description: 'Maximum results (default: 50)' },
        startAt: { type: 'number', description: 'Pagination offset (default: 0)' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Fields to include' },
      },
      required: ['jql'],
    },
  },
  {
    name: 'transitionJiraIssue',
    description: 'Transition a Jira issue to a new workflow state.',
    inputSchema: {
      type: 'object',
      properties: {
        issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
        transitionId: { type: 'string', description: 'Transition ID (get from getTransitionsForJiraIssue)' },
        comment: { type: 'string', description: 'Optional comment to add with transition' },
      },
      required: ['issueIdOrKey', 'transitionId'],
    },
  },
  {
    name: 'getTransitionsForJiraIssue',
    description: 'List available workflow transitions for a Jira issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
      },
      required: ['issueIdOrKey'],
    },
  },
  {
    name: 'addCommentToJiraIssue',
    description: 'Add a comment to a Jira issue.',
    inputSchema: {
      type: 'object',
      properties: {
        issueIdOrKey: { type: 'string', description: 'Issue ID or key' },
        body: { type: 'string', description: 'Comment text' },
      },
      required: ['issueIdOrKey', 'body'],
    },
  },
  {
    name: 'bulkCreateJiraIssues',
    description: 'Create multiple Jira issues at once. Returns created issue keys.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              projectKey: { type: 'string' },
              issueType: { type: 'string' },
              summary: { type: 'string' },
              description: { type: 'string' },
              assigneeAccountId: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              priority: { type: 'string' },
            },
            required: ['projectKey', 'issueType', 'summary'],
          },
          description: 'Array of issues to create',
        },
      },
      required: ['issues'],
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

function textToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function buildIssueFields(p: CreateIssueArgs | BulkCreateArgs['issues'][number]) {
  const fields: Record<string, unknown> = {
    project: { key: p.projectKey },
    issuetype: { name: p.issueType },
    summary: p.summary,
  };
  if (p.description) fields.description = textToAdf(p.description);
  if (p.assigneeAccountId) fields.assignee = { accountId: p.assigneeAccountId };
  if (p.labels) fields.labels = p.labels;
  if (p.priority) fields.priority = { name: p.priority };
  if ('components' in p && p.components) {
    fields.components = p.components.map((name) => ({ name }));
  }
  if ('additionalFields' in p && p.additionalFields) {
    Object.assign(fields, p.additionalFields);
  }
  return fields;
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function err(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
}

async function parseResponse(res: { ok: boolean; status: number; json: () => Promise<unknown> }): Promise<McpToolResult> {
  if (res.status === 204) return ok('OK');
  const data = await res.json();
  return res.ok ? ok(data) : err(data);
}

// ── Handler ─────────────────────────────────────────────────────────────

export async function handleIssueTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  switch (name) {
    case 'createJiraIssue': {
      const a = args as unknown as CreateIssueArgs;
      const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ fields: buildIssueFields(a) }),
      });
      return parseResponse(res);
    }

    case 'editJiraIssue': {
      const a = args as unknown as EditIssueArgs;
      const fields: Record<string, unknown> = {};
      if (a.summary) fields.summary = a.summary;
      if (a.description) fields.description = textToAdf(a.description);
      if (a.assigneeAccountId) fields.assignee = { accountId: a.assigneeAccountId };
      if (a.labels) fields.labels = a.labels;
      if (a.priority) fields.priority = { name: a.priority };
      if (a.additionalFields) Object.assign(fields, a.additionalFields);

      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${a.issueIdOrKey}`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ fields }),
        },
      );
      return parseResponse(res);
    }

    case 'getJiraIssue': {
      const a = args as unknown as GetIssueArgs;
      const qs = a.fields ? new URLSearchParams({ fields: a.fields.join(',') }) : '';
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${a.issueIdOrKey}?${qs}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    case 'searchJiraIssuesUsingJql': {
      const a = args as unknown as SearchIssuesArgs;
      const params = new URLSearchParams({
        jql: a.jql,
        maxResults: String(a.maxResults ?? 50),
        startAt: String(a.startAt ?? 0),
      });
      if (a.fields) params.set('fields', a.fields.join(','));

      const res = await api.asApp().requestJira(
        route`/rest/api/3/search/jql?${params}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    case 'transitionJiraIssue': {
      const a = args as unknown as TransitionIssueArgs;
      const body: Record<string, unknown> = { transition: { id: a.transitionId } };
      if (a.comment) {
        body.update = { comment: [{ add: { body: textToAdf(a.comment) } }] };
      }
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${a.issueIdOrKey}/transitions`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        },
      );
      return parseResponse(res);
    }

    case 'getTransitionsForJiraIssue': {
      const a = args as unknown as IssueKeyArgs;
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${a.issueIdOrKey}/transitions`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      return parseResponse(res);
    }

    case 'addCommentToJiraIssue': {
      const a = args as unknown as AddCommentArgs;
      const res = await api.asApp().requestJira(
        route`/rest/api/3/issue/${a.issueIdOrKey}/comment`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ body: textToAdf(a.body) }),
        },
      );
      return parseResponse(res);
    }

    case 'bulkCreateJiraIssues': {
      const a = args as unknown as BulkCreateArgs;
      const issueUpdates = a.issues.map((issue) => ({ fields: buildIssueFields(issue) }));
      const res = await api.asApp().requestJira(route`/rest/api/3/issue/bulk`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ issueUpdates }),
      });
      return parseResponse(res);
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
