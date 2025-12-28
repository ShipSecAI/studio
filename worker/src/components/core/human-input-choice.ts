import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  registerContract,
} from '@shipsec/component-sdk';

/**
 * Human Input Choice Component
 *
 * Pauses workflow to ask the user to select from a list of options.
 */

const inputSchema = z.object({
  data: z.any().optional().describe('Optional data to include in the context'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  pending: z.literal(true),
  requestId: z.string(),
  inputType: z.literal('selection'),
  title: z.string(),
  description: z.string().nullable(),
  options: z.array(z.union([z.string(), z.object({ label: z.string(), value: z.string() })])),
  multiple: z.boolean(),
  timeoutAt: z.string().nullable(),
});

type Output = z.infer<typeof outputSchema>;

const HUMAN_INPUT_PENDING_CONTRACT = 'core.human-input.pending.v1';

registerContract({
  name: HUMAN_INPUT_PENDING_CONTRACT,
  schema: outputSchema,
  summary: 'Human input pending response',
  description: 'Indicates that a workflow is waiting for human input.',
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.interaction.human-choice',
  label: 'Multiple Choice Input',
  category: 'interaction',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Pauses workflow execution until a user selects an option from a list.',
  metadata: {
    slug: 'human-choice',
    version: '1.0.0',
    type: 'process',
    category: 'interaction',
    description: 'Ask the user to select from a list of options.',
    icon: 'ListChecks',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'data',
        label: 'Context Data',
        dataType: port.any(),
        required: false,
        description: 'Data to contextually show to the user',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'Input Request',
        dataType: port.contract(HUMAN_INPUT_PENDING_CONTRACT),
        description: 'The pending request details',
      },
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
        placeholder: 'Please choose one...',
        description: 'Instructions for the user',
      },
      {
        id: 'options',
        label: 'Options',
        type: 'json', // Assuming JSON editor for options list
        required: true,
        placeholder: '["Option A", "Option B"]',
        description: 'List of options (strings or {label, value} objects)',
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
  async execute(params, context) {
    const title = (context as any).parameters?.title || 'Input Required';
    const description = (context as any).parameters?.description || null;
    const timeoutStr = (context as any).parameters?.timeout;
    const optionsRaw = (context as any).parameters?.options;
    const multiple = (context as any).parameters?.multiple === true;

    // Parse options
    let options: Array<string | { label: string; value: string }> = [];
    if (Array.isArray(optionsRaw)) {
        options = optionsRaw;
    } else if (typeof optionsRaw === 'string') {
        try {
            options = JSON.parse(optionsRaw);
        } catch (e) {
            // Fallback: comma separated?
            options = optionsRaw.split(',').map(s => s.trim());
        }
    }

    if (!Array.isArray(options) || options.length === 0) {
        throw new Error('Human Choice component requires at least one option.');
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
    
    context.logger.info(`[Human Choice] Created request: ${title}`);

    return {
      pending: true as const,
      requestId,
      inputType: 'selection',
      title,
      description,
      options,
      multiple,
      timeoutAt,
    };
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
