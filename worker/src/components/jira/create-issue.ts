import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  ConfigurationError,
} from '@shipsec/component-sdk';

const LOG_PREFIX = '[Jira Create Issue]';

const inputSchema = inputs({
  findings: port(z.any().optional(), {
    label: 'Findings',
    description:
      'Security findings to include in the issue description. Can be any structured data.',
    connectionType: { kind: 'primitive', name: 'json' },
    allowAny: true,
    reason: 'Accepts any structured security findings data from upstream scanners.',
  }),
});

const parameterSchema = parameters({
  webTriggerUrl: param(z.string().url(), {
    label: 'Jira Web Trigger URL',
    editor: 'secret',
    description: 'The Forge app web trigger URL. Found in Integrations → Jira.',
  }),
  sharedSecret: param(z.string().default(''), {
    label: 'Shared Secret',
    editor: 'secret',
    description: 'Optional shared secret for request verification.',
  }),
  projectKey: param(z.string(), {
    label: 'Project Key',
    editor: 'text',
    description: 'Jira project key (e.g. "SEC", "VULN").',
  }),
  issueType: param(z.string().default('Task'), {
    label: 'Issue Type',
    editor: 'select',
    options: [
      { label: 'Task', value: 'Task' },
      { label: 'Bug', value: 'Bug' },
      { label: 'Story', value: 'Story' },
      { label: 'Epic', value: 'Epic' },
    ],
  }),
  summary: param(z.string(), {
    label: 'Summary Template',
    editor: 'text',
    description: 'Issue summary. Use {{variable}} for dynamic values.',
  }),
  description: param(z.string().default(''), {
    label: 'Description Template',
    editor: 'textarea',
    description:
      'Issue description. Use {{variable}} for dynamic values. If findings are connected, they will be appended.',
  }),
  labels: param(z.string().default(''), {
    label: 'Labels',
    editor: 'text',
    description: 'Comma-separated labels (e.g. "vulnerability,critical,auto-triaged").',
  }),
  priority: param(z.string().default('Medium'), {
    label: 'Priority',
    editor: 'select',
    options: [
      { label: 'Highest', value: 'Highest' },
      { label: 'High', value: 'High' },
      { label: 'Medium', value: 'Medium' },
      { label: 'Low', value: 'Low' },
      { label: 'Lowest', value: 'Lowest' },
    ],
  }),
  assigneeAccountId: param(z.string().default(''), {
    label: 'Assignee Account ID',
    editor: 'text',
    description: 'Jira account ID of the assignee. Leave blank for unassigned.',
  }),
});

const outputSchema = outputs({
  issueKey: port(z.string(), {
    label: 'Issue Key',
    description: 'Created Jira issue key (e.g. "SEC-42")',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  issueId: port(z.string(), {
    label: 'Issue ID',
    description: 'Created Jira issue numeric ID',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  issueUrl: port(z.string(), {
    label: 'Issue URL',
    description: 'Direct link to the created Jira issue',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

async function callJiraMcp(
  webTriggerUrl: string,
  sharedSecret: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sharedSecret) {
    headers['x-shipsec-secret'] = sharedSecret;
  }

  const response = await fetch(webTriggerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!response.ok) {
    throw new Error(`Jira MCP request failed: ${response.status} ${response.statusText}`);
  }

  const rpcResponse = (await response.json()) as {
    result?: { content?: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };

  if (rpcResponse.error) {
    throw new Error(`Jira MCP error: ${rpcResponse.error.message}`);
  }

  const text = rpcResponse.result?.content?.[0]?.text;
  if (rpcResponse.result?.isError) {
    throw new Error(`Jira API error: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

const definition = defineComponent({
  id: 'jira.create-issue',
  label: 'Jira: Create Issue',
  category: 'notification',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Create a Jira issue via the ShipSec Forge app. Issues are created with bot identity.',
  ui: {
    slug: 'jira-create-issue',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description:
      'Create Jira issues for vulnerability tracking, incident management, and team coordination.',
    icon: 'TicketCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Create vulnerability tickets from Trivy scan results',
      'Open incident tickets for critical findings',
      'Track remediation tasks in Jira sprints',
    ],
  },
  async execute({ inputs, params }, context) {
    const {
      webTriggerUrl,
      sharedSecret,
      projectKey,
      issueType,
      summary,
      description,
      labels,
      priority,
      assigneeAccountId,
    } = params;

    if (!webTriggerUrl) {
      throw new ConfigurationError(
        'Jira Web Trigger URL is required. Configure it in Integrations → Jira.',
      );
    }
    if (!projectKey) {
      throw new ConfigurationError('Jira Project Key is required.');
    }
    if (!summary) {
      throw new ConfigurationError('Issue summary is required.');
    }

    context.logger.info(`${LOG_PREFIX} Creating issue in ${projectKey}`);
    context.emitProgress({
      message: `Creating Jira issue in ${projectKey}...`,
      level: 'info',
      data: { projectKey, issueType, stage: 'start' },
    });

    // Build description with findings if available
    let fullDescription = description || '';
    if (inputs.findings) {
      const findingsText =
        typeof inputs.findings === 'string'
          ? inputs.findings
          : JSON.stringify(inputs.findings, null, 2);
      fullDescription += fullDescription ? '\n\n---\n\n' : '';
      fullDescription += `**Security Findings:**\n\`\`\`\n${findingsText}\n\`\`\``;
    }

    const createArgs: Record<string, unknown> = {
      projectKey,
      issueType,
      summary,
      priority,
    };

    if (fullDescription) createArgs.description = fullDescription;
    if (labels)
      createArgs.labels = labels
        .split(',')
        .map((l: string) => l.trim())
        .filter(Boolean);
    if (assigneeAccountId) createArgs.assigneeAccountId = assigneeAccountId;

    const result = (await callJiraMcp(
      webTriggerUrl,
      sharedSecret,
      'createJiraIssue',
      createArgs,
    )) as {
      id: string;
      key: string;
      self: string;
    };

    if (!result?.key) {
      throw new Error(`Unexpected Jira response: ${JSON.stringify(result)}`);
    }

    // Extract the site URL from the self link
    // self: "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/12345"
    // We want: "https://{site}.atlassian.net/browse/{key}"
    const issueUrl = result.self.replace(/\/rest\/api\/3\/issue\/.*$/, `/browse/${result.key}`);

    context.logger.info(`${LOG_PREFIX} Created ${result.key}`);
    context.emitProgress({
      message: `Created Jira issue ${result.key}`,
      level: 'info',
      data: { issueKey: result.key, issueId: result.id, stage: 'done' },
    });

    return {
      issueKey: result.key,
      issueId: result.id,
      issueUrl,
    };
  },
});

componentRegistry.register(definition);
