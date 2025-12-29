import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  registerContract,
} from '@shipsec/component-sdk';

/**
 * Manual Approval Component
 * 
 * This component creates a human-in-the-loop gate that pauses workflow execution
 * until a human approves or rejects the request.
 * 
 * It supports dynamic description templates using context variables.
 */

const inputSchema = z.object({
  // Dynamic variables will be injected here by resolvePorts via .catchall(z.any())
}).catchall(z.any());

type Input = z.infer<typeof inputSchema>;

type Params = {
  title?: string;
  description?: string;
  variables?: { name: string; type: string }[];
  timeout?: string;
};

/**
 * Simple helper to replace {{var}} placeholders in a string
 */
function interpolate(template: string, vars: Record<string, any>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

const mapTypeToPort = (type: string, id: string, label: string) => {
    switch (type) {
      case 'string': return { id, label, dataType: port.text(), required: false };
      case 'number': return { id, label, dataType: port.number(), required: false };
      case 'boolean': return { id, label, dataType: port.boolean(), required: false };
      case 'secret': return { id, label, dataType: port.secret(), required: false };
      case 'list': return { id, label, dataType: port.list(port.text()), required: false };
      default: return { id, label, dataType: port.any(), required: false };
    }
  };

const outputSchema = z.object({
  approved: z.boolean().describe('Whether the request was approved'),
  respondedBy: z.string().describe('Who responded to the request'),
  responseNote: z.string().optional().describe('Note provided by the responder'),
  respondedAt: z.string().describe('When the request was resolved'),
  requestId: z.string().describe('The ID of the human input request'),
});

type Output = z.infer<typeof outputSchema>;

const APPROVAL_PENDING_CONTRACT = 'core.manual-approval.pending.v1';

registerContract({
  name: APPROVAL_PENDING_CONTRACT,
  schema: outputSchema,
  summary: 'Manual approval pending response',
  description:
    'Indicates that a workflow is waiting for manual approval. Contains the approval request ID and tokens for approve/reject actions.',
});

const definition: ComponentDefinition<Input, Output, Params> = {
  id: 'core.manual_action.approval',
  label: 'Manual Approval',
  category: 'manual_action',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Pauses workflow execution until a human approves or rejects. Supports Markdown and dynamic context variables in the description.',
  metadata: {
    slug: 'manual-approval',
    version: '1.2.0',
    type: 'process',
    category: 'manual_action',
    description: 'Pause and wait for manual approval. Supports dynamic templates for providing context to the reviewer.',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [
      {
        id: 'approved',
        label: 'Approved',
        dataType: port.boolean(),
        description: 'Active path when request is approved',
        isBranching: true,
        branchColor: 'green',
      },
      {
        id: 'rejected',
        label: 'Rejected',
        dataType: port.boolean(),
        description: 'Active path when request is rejected',
        isBranching: true,
        branchColor: 'red',
      },
      {
          id: 'respondedBy',
          label: 'Responded By',
          dataType: port.text(),
          description: 'The user who resolved this request',
      },
      {
          id: 'responseNote',
          label: 'Response Note',
          dataType: port.text(),
          description: 'The comment left by the responder',
      }
    ],
    parameters: [
      {
        id: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Approval Required',
        description: 'Title for the approval request',
      },
      {
        id: 'description',
        label: 'Description',
        type: 'textarea',
        required: false,
        placeholder: 'Please review and approve... You can use {{variable}} here.',
        description: 'Detailed description (Markdown supported)',
        helpText: 'Provide context about what needs to be approved. Supports interpolation.',
      },
      {
          id: 'variables',
          label: 'Context Variables',
          type: 'variable-list',
          default: [],
          description: 'Define variables to use as {{name}} in your description.',
      },
      {
        id: 'timeout',
        label: 'Timeout',
        type: 'text',
        required: false,
        placeholder: '24h',
        description: 'How long to wait for approval (e.g., "1h", "24h", "7d")',
      },
    ],
  },
  resolvePorts(params: any) {
    const inputs: any[] = [];
    if (params.variables && Array.isArray(params.variables)) {
        for (const v of params.variables) {
            if (!v || !v.name) continue;
            inputs.push(mapTypeToPort(v.type || 'json', v.name, v.name));
        }
    }
    return { inputs };
  },
  async execute(params, context) {
    const titleTemplate = params.title || 'Approval Required';
    const descriptionTemplate = params.description || '';
    const timeoutStr = params.timeout;

    // Interpolate values
    const title = interpolate(titleTemplate, params);
    const description = interpolate(descriptionTemplate, params);

    // Calculate timeout
    let timeoutAt: string | null = null;
    if (timeoutStr) {
      const timeout = parseTimeout(timeoutStr);
      if (timeout) {
        timeoutAt = new Date(Date.now() + timeout).toISOString();
      }
    }

    const requestId = `req-${context.runId}-${context.componentRef}`;

    context.logger.info(`[Manual Approval] Created request: ${title}`);

    return {
      pending: true as const,
      requestId,
      inputType: 'approval' as const,
      title,
      description,
      timeoutAt,
      contextData: params,
    } as any;
  },
};

function parseTimeout(timeout: string): number | null {
  const match = timeout.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

componentRegistry.register(definition);
