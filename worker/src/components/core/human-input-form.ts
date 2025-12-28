import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  registerContract,
} from '@shipsec/component-sdk';

/**
 * Human Input Form Component
 *
 * Pauses workflow to ask the user to fill out a form.
 */

const inputSchema = z.object({
  data: z.any().optional().describe('Optional data to include in the context'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  pending: z.literal(true),
  requestId: z.string(),
  inputType: z.literal('form'),
  title: z.string(),
  description: z.string().nullable(),
  schema: z.record(z.string(), z.unknown()),
  timeoutAt: z.string().nullable(),
});

type Output = z.infer<typeof outputSchema>;

// Reuse contract name if possible, or define specific one. 
// Since structure differs (schema vs options), maybe separate contract or union?
// For now, I'll use a new contract string to avoid collision if strict validation exists.
const HUMAN_FORM_PENDING_CONTRACT = 'core.human-form.pending.v1';

registerContract({
  name: HUMAN_FORM_PENDING_CONTRACT,
  schema: outputSchema,
  summary: 'Human form pending response',
  description: 'Indicates that a workflow is waiting for human form input.',
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.interaction.human-form',
  label: 'Form Input',
  category: 'interaction',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Pauses workflow execution until a user fills out a form.',
  metadata: {
    slug: 'human-form',
    version: '1.0.0',
    type: 'process',
    category: 'interaction',
    description: 'Collect structured data from a user via a form.',
    icon: 'FormInput', 
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
        label: 'Form Request',
        dataType: port.contract(HUMAN_FORM_PENDING_CONTRACT),
        description: 'The pending form request details',
      },
    ],
    parameters: [
      {
        id: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Information Required',
        description: 'Title for the form',
      },
      {
        id: 'description',
        label: 'Description',
        type: 'textarea',
        required: false,
        placeholder: 'Please provide the details below...',
        description: 'Instructions for the user',
      },
      {
        id: 'schema',
        label: 'Form Schema',
        type: 'json',
        required: true,
        placeholder: '{"type": "object", "properties": {"reason": {"type": "string"}}}',
        description: 'JSON Schema defining the form fields',
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
    const title = (context as any).parameters?.title || 'Form Input Required';
    const description = (context as any).parameters?.description || null;
    const timeoutStr = (context as any).parameters?.timeout;
    const schemaRaw = (context as any).parameters?.schema;

    // Parse schema
    let schema: Record<string, unknown> = {};
    if (typeof schemaRaw === 'string') {
        try {
            schema = JSON.parse(schemaRaw);
        } catch (e) {
            throw new Error('Invalid JSON Schema string provided.');
        }
    } else if (typeof schemaRaw === 'object' && schemaRaw !== null) {
        schema = schemaRaw as Record<string, unknown>;
    } else {
        throw new Error('Form Schema must be a valid JSON object or string.');
    }

    // Measure timeout
    let timeoutAt: string | null = null;
    if (timeoutStr) {
      const timeout = parseTimeout(timeoutStr);
      if (timeout) {
        timeoutAt = new Date(Date.now() + timeout).toISOString();
      }
    }

    const requestId = `req-${context.runId}-${context.componentRef}`;
    
    context.logger.info(`[Human Form] Created request: ${title}`);

    return {
      pending: true as const,
      requestId,
      inputType: 'form',
      title,
      description,
      schema,
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
