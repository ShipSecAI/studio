import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  type PortMeta,
} from '@shipsec/component-sdk';

/**
 * Manual Selection Component
 *
 * Pauses workflow to ask the user to select from a list of options.
 * Supports dynamic templates for title and description.
 */

const inputSchema = inputs({
  // Dynamic variables will be injected here by resolvePorts
});

const outputSchema = outputs({
  selection: port(z.unknown().describe('The selected option(s)'), {
    label: 'Selection',
    description: 'The selected option(s).',
    allowAny: true,
    reason: 'Selection shape depends on whether multiple selections are enabled.',
    connectionType: { kind: 'any' },
  }),
  approved: port(z.boolean().describe('Whether the request was approved'), {
    label: 'Approved',
    description: 'True when the selection is accepted.',
    isBranching: true,
    branchColor: 'green',
  }),
  rejected: port(z.boolean().describe('Whether the request was rejected'), {
    label: 'Rejected',
    description: 'True when the selection is rejected.',
    isBranching: true,
    branchColor: 'red',
  }),
  respondedBy: port(z.string().describe('Who responded to the request'), {
    label: 'Responded By',
    description: 'The user who resolved this request.',
  }),
  responseNote: port(z.string().optional().describe('Note provided by the responder'), {
    label: 'Response Note',
    description: 'Optional comment left by the responder.',
  }),
  respondedAt: port(z.string().describe('When the request was resolved'), {
    label: 'Responded At',
    description: 'Timestamp when the request was resolved.',
  }),
  requestId: port(z.string().describe('The ID of the human input request'), {
    label: 'Request ID',
    description: 'Unique identifier for the manual selection request.',
  }),
});

const parameterSchema = parameters({
  title: param(z.string().optional(), {
    label: 'Title',
    editor: 'text',
    placeholder: 'Select an option',
    description: 'Title for the request',
  }),
  description: param(z.string().optional(), {
    label: 'Description',
    editor: 'textarea',
    placeholder: 'Please choose one... You can use {{variable}} here.',
    description: 'Instructions (Markdown supported)',
    helpText: 'Provide context for the selection. Supports interpolation.',
  }),
  variables: param(
    z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
    {
      label: 'Context Variables',
      editor: 'variable-list',
      description: 'Define variables to use as {{name}} in your description and options.',
    },
  ),
  options: param(
    z.array(z.union([z.string(), z.object({ label: z.string(), value: z.string() })])).default([]),
    {
      label: 'Option Designer',
      editor: 'selection-options',
      description: 'Design the list of options interactively.',
    },
  ),
  multiple: param(z.boolean().default(false), {
    label: 'Allow Multiple',
    editor: 'boolean',
    description: 'Allow selecting multiple options',
  }),
  timeout: param(z.string().optional(), {
    label: 'Timeout',
    editor: 'text',
    placeholder: '24h',
    description: 'Time to wait (e.g. 1h, 24h)',
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
          reason: 'Manual selection inputs can include secrets.',
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
          reason: 'Manual selection inputs can include arbitrary JSON.',
          connectionType: { kind: 'primitive', name: 'json' } as const,
        },
      };
  }
};

const definition = defineComponent({
  id: 'core.manual_action.selection',
  label: 'Manual Selection',
  category: 'manual_action',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 1,
    nonRetryableErrorTypes: ['ValidationError'],
  } satisfies ComponentRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Pauses workflow execution until a user selects an option. Supports Markdown and dynamic context variables.',
  ui: {
    slug: 'manual-selection',
    version: '1.3.0',
    type: 'process',
    category: 'manual_action',
    description:
      'Ask the user to select from a list of options. Supports dynamic context templates.',
    icon: 'ListChecks',
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

    // Output port for the selection itself
    const outputShape: Record<string, z.ZodTypeAny> = {
      selection: port(params.multiple ? z.array(z.string()) : z.string(), {
        label: 'Selection',
        description: 'The selected value(s)',
        connectionType: params.multiple
          ? { kind: 'list', element: { kind: 'primitive', name: 'text' } }
          : { kind: 'primitive', name: 'text' },
      }),
      approved: port(z.boolean(), {
        label: 'Approved',
        description: 'True if approved, false if rejected',
      }),
      respondedBy: port(z.string(), {
        label: 'Responded By',
        description: 'The user who resolved this request',
      }),
    };

    // Add dynamic ports for each option
    if (params.options && Array.isArray(params.options)) {
      for (const opt of params.options) {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label || opt.value;
        if (val) {
          // Use a prefix to avoid collisions with standard ports
          // We use the value as the ID suffix.
          // Note: Values must be safe for port IDs (alphanumeric, -, _)
          // We might want to sanitize it.
          outputShape[`option:${val}`] = port(z.boolean(), {
            label: `Option: ${label}`,
            description: `Active when '${label}' is selected`,
            isBranching: true,
          });
        }
      }
    }

    return { inputs: inputs(inputShape), outputs: outputs(outputShape) };
  },
  async execute({ inputs, params }, context) {
    const titleTemplate = params.title || 'Input Required';
    const descriptionTemplate = params.description || '';
    const timeoutStr = params.timeout;
    const optionsRaw = params.options || [];
    const multiple = params.multiple === true;

    // Interpolate
    const contextData = { ...params, ...inputs };
    const title = interpolate(titleTemplate, contextData);
    const description = interpolate(descriptionTemplate, contextData);

    // Parse and interpolate options
    let options: { label: string; value: string }[] = [];
    if (Array.isArray(optionsRaw)) {
      options = optionsRaw.map((opt) => {
        if (typeof opt === 'string') {
          const val = interpolate(opt, contextData);
          return { label: val, value: val };
        }
        return {
          label: interpolate(opt.label || opt.value, contextData),
          value: opt.value,
        };
      });
    }

    if (options.length === 0) {
      throw new ValidationError('Manual Selection component requires at least one option.', {
        fieldErrors: { options: ['At least one option is required'] },
      });
    }

    // Calculate timeout
    let timeoutAt: string | null = null;
    if (timeoutStr) {
      const timeout = parseTimeout(timeoutStr);
      if (timeout) {
        timeoutAt = new Date(Date.now() + timeout).toISOString();
      }
    }

    const requestId = `req-${context.runId}-${context.componentRef}`;

    context.logger.info(`[Manual Selection] Created request: ${title}`);

    return {
      pending: true as const,
      requestId,
      inputType: 'selection' as const,
      title,
      description,
      inputSchema: { options, multiple },
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

export { definition };
