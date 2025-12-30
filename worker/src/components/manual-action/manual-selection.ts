import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  registerContract,
  ValidationError,
} from '@shipsec/component-sdk';

/**
 * Manual Selection Component
 *
 * Pauses workflow to ask the user to select from a list of options.
 * Supports dynamic templates for title and description.
 */

const inputSchema = z.object({
  // Dynamic variables will be injected here by resolvePorts
}).catchall(z.any());

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  selection: z.any().describe('The selected option(s)'),
  approved: z.boolean().describe('Whether the request was approved'),
  respondedBy: z.string().describe('Who responded to the request'),
  responseNote: z.string().optional().describe('Note provided by the responder'),
  respondedAt: z.string().describe('When the request was resolved'),
  requestId: z.string().describe('The ID of the human input request'),
});

type Output = z.infer<typeof outputSchema>;

type Params = {
  title?: string;
  description?: string;
  variables?: { name: string; type: string }[];
  options?: { label: string; value: string }[] | string[];
  multiple?: boolean;
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

const HUMAN_INPUT_PENDING_CONTRACT = 'core.manual-selection.pending.v1';

registerContract({
  name: HUMAN_INPUT_PENDING_CONTRACT,
  schema: outputSchema,
  summary: 'Manual selection pending response',
  description: 'Indicates that a workflow is waiting for manual selection input.',
});

const definition: ComponentDefinition<Input, Output, Params> = {
  id: 'core.manual_action.selection',
  label: 'Manual Selection',
  category: 'manual_action',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 1,
    nonRetryableErrorTypes: ['ValidationError'],
  } satisfies ComponentRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Pauses workflow execution until a user selects an option. Supports Markdown and dynamic context variables.',
  metadata: {
    slug: 'manual-selection',
    version: '1.3.0',
    type: 'process',
    category: 'manual_action',
    description: 'Ask the user to select from a list of options. Supports dynamic context templates.',
    icon: 'ListChecks',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    outputs: [
      {
        id: 'selection',
        label: 'Selection',
        dataType: port.any(),
        description: 'The selected value(s)',
      },
      {
        id: 'approved',
        label: 'Approved',
        dataType: port.boolean(),
        description: 'True if approved, false if rejected',
      },
      {
        id: 'respondedBy',
        label: 'Responded By',
        dataType: port.text(),
        description: 'The user who resolved this request',
      }
    ],
    parameters: [
      {
        id: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Select an option',
        description: 'Title for the request',
      },
      {
        id: 'description',
        label: 'Description',
        type: 'textarea',
        required: false,
        placeholder: 'Please choose one... You can use {{variable}} here.',
        description: 'Instructions (Markdown supported)',
        helpText: 'Provide context for the selection. Supports interpolation.',
      },
      {
          id: 'variables',
          label: 'Context Variables',
          type: 'variable-list',
          default: [],
          description: 'Define variables to use as {{name}} in your description and options.',
      },
      {
        id: 'options',
        label: 'Option Designer',
        type: 'selection-options',
        required: true,
        default: [],
        description: 'Design the list of options interactively.',
      },
      {
        id: 'multiple',
        label: 'Allow Multiple',
        type: 'boolean',
        required: false,
        description: 'Allow selecting multiple options',
        default: false,
      },
      {
        id: 'timeout',
        label: 'Timeout',
        type: 'text',
        required: false,
        placeholder: '24h',
        description: 'Time to wait (e.g. 1h, 24h)',
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
    
    // Output port for the selection itself
    const outputs: any[] = [
        { id: 'selection', label: 'Selection', dataType: params.multiple ? port.list(port.text()) : port.text() },
        { id: 'approved', label: 'Approved', dataType: port.boolean() },
        { id: 'respondedBy', label: 'Responded By', dataType: port.text() },
    ];

    // Add dynamic ports for each option
    if (params.options && Array.isArray(params.options)) {
        for (const opt of params.options) {
            const val = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? opt : (opt.label || opt.value);
            if (val) {
                // Use a prefix to avoid collisions with standard ports
                // We use the value as the ID suffix. 
                // Note: Values must be safe for port IDs (alphanumeric, -, _)
                // We might want to sanitize it.
                outputs.push({
                    id: `option:${val}`, 
                    label: `Option: ${label}`,
                    dataType: port.boolean(),
                    description: `Active when '${label}' is selected`,
                    isBranching: true,
                });
            }
        }
    }
    
    return { inputs, outputs };
  },
  async execute(params, context) {
    const titleTemplate = params.title || 'Input Required';
    const descriptionTemplate = params.description || '';
    const timeoutStr = params.timeout;
    const optionsRaw = params.options || [];
    const multiple = params.multiple === true;

    // Interpolate
    const title = interpolate(titleTemplate, params);
    const description = interpolate(descriptionTemplate, params);

    // Parse and interpolate options
    let options: Array<{ label: string; value: string }> = [];
    if (Array.isArray(optionsRaw)) {
        options = optionsRaw.map(opt => {
            if (typeof opt === 'string') {
                const val = interpolate(opt, params);
                return { label: val, value: val };
            }
            return {
                label: interpolate(opt.label || opt.value, params),
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

export { definition };
