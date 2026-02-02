import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  type PortMeta,
} from '@shipsec/component-sdk';

/**
 * Manual Approval Component
 *
 * This component creates a human-in-the-loop gate that pauses workflow execution
 * until a human approves or rejects the request.
 *
 * It supports dynamic description templates using context variables.
 */

const inputSchema = inputs({
  // Dynamic variables will be injected here by resolvePorts
});

const parameterSchema = parameters({
  title: param(z.string().optional(), {
    label: 'Title',
    editor: 'text',
    placeholder: 'Approval Required',
    description: 'Title for the approval request',
  }),
  description: param(z.string().optional(), {
    label: 'Description',
    editor: 'textarea',
    placeholder: 'Please review and approve... You can use {{variable}} here.',
    description: 'Detailed description (Markdown supported)',
    helpText: 'Provide context about what needs to be approved. Supports interpolation.',
  }),
  variables: param(
    z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
    {
      label: 'Context Variables',
      editor: 'variable-list',
      description: 'Define variables to use as {{name}} in your description.',
    },
  ),
  timeout: param(z.string().optional(), {
    label: 'Timeout',
    editor: 'text',
    placeholder: '24h',
    description: 'How long to wait for approval (e.g., "1h", "24h", "7d")',
  }),
});

/**
 * Simple helper to replace {{var}} placeholders in a string
 */
function interpolate(template: string, vars: Record<string, any>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

const mapTypeToSchema = (type: string): { schema: z.ZodTypeAny; meta?: PortMeta } => {
  switch (type) {
    case 'string':
      return { schema: z.string() };
    case 'number':
      return { schema: z.number() };
    case 'boolean':
      return { schema: z.boolean() };
    case 'secret':
      return {
        schema: z.unknown(),
        meta: {
          editor: 'secret',
          allowAny: true,
          reason: 'Manual approval inputs can include raw secrets.',
          connectionType: { kind: 'primitive', name: 'secret' } as const,
        },
      };
    case 'list':
      return { schema: z.array(z.string()) };
    default:
      return {
        schema: z.unknown(),
        meta: {
          allowAny: true,
          reason: 'Manual approval inputs can include arbitrary JSON.',
          connectionType: { kind: 'primitive', name: 'json' } as const,
        },
      };
  }
};

const outputSchema = outputs({
  approved: port(z.boolean().describe('Whether the request was approved'), {
    label: 'Approved',
    description: 'Active path when request is approved',
    isBranching: true,
    branchColor: 'green',
  }),
  rejected: port(z.boolean().describe('Whether the request was rejected'), {
    label: 'Rejected',
    description: 'Active path when request is rejected',
    isBranching: true,
    branchColor: 'red',
  }),
  respondedBy: port(z.string().describe('Who responded to the request'), {
    label: 'Responded By',
    description: 'The user who resolved this request',
  }),
  responseNote: port(z.string().optional().describe('Note provided by the responder'), {
    label: 'Response Note',
    description: 'The comment left by the responder',
  }),
  respondedAt: port(z.string().describe('When the request was resolved'), {
    label: 'Responded At',
    description: 'Timestamp when the request was resolved.',
  }),
  requestId: port(z.string().describe('The ID of the human input request'), {
    label: 'Request ID',
    description: 'Unique identifier for the manual approval request.',
  }),
});

const definition = defineComponent({
  id: 'core.manual_action.approval',
  label: 'Manual Approval',
  category: 'manual_action',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Pauses workflow execution until a human approves or rejects. Supports Markdown and dynamic context variables in the description.',
  ui: {
    slug: 'manual-approval',
    version: '1.2.0',
    type: 'process',
    category: 'manual_action',
    description:
      'Pause and wait for manual approval. Supports dynamic templates for providing context to the reviewer.',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {};
    if (params.variables && Array.isArray(params.variables)) {
      for (const v of params.variables) {
        if (!v || !v.name) continue;
        const { schema, meta } = mapTypeToSchema(v.type || 'json');
        inputShape[v.name] = port(schema.optional(), {
          ...(meta ?? {}),
          label: v.name,
        });
      }
    }
    return {
      inputs: inputs(inputShape),
      outputs: outputSchema,
    };
  },
  async execute({ inputs, params }, context) {
    const titleTemplate = params.title || 'Approval Required';
    const descriptionTemplate = params.description || '';
    const timeoutStr = params.timeout;

    // Interpolate values
    const contextData = { ...params, ...inputs };
    const title = interpolate(titleTemplate, contextData);
    const description = interpolate(descriptionTemplate, contextData);

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
      contextData,
    } as any;
  },
});

function parseTimeout(timeout: string): number | null {
  const match = timeout.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

componentRegistry.register(definition);
