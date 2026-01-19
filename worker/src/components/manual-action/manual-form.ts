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
 * Manual Form Component
 *
 * Pauses workflow to ask the user to fill out a form.
 * Supports dynamic templates for title and description.
 */

const inputSchema = inputs({
  // Dynamic variables will be injected here by resolvePorts
});

const outputSchema = outputs({
  approved: port(z.boolean(), {
    label: 'Approved',
  }),
  respondedBy: port(z.string(), {
    label: 'Responded By',
  }),
});

const parameterSchema = parameters({
  title: param(z.string().optional(), {
    label: 'Title',
    editor: 'text',
    placeholder: 'Information Required',
    description: 'Title for the form',
  }),
  description: param(z.string().optional(), {
    label: 'Description',
    editor: 'textarea',
    placeholder: 'Please provide details below... You can use {{variable}} here.',
    description: 'Instructions (Markdown supported)',
    helpText: 'Provide context for the form. Supports interpolation.',
  }),
  variables: param(
    z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
    {
      label: 'Context Variables',
      editor: 'variable-list',
      description: 'Define variables to use as {{name}} in your description and form fields.',
    },
  ),
  schema: param(
    z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          type: z.string(),
          required: z.boolean(),
          placeholder: z.string().optional(),
          description: z.string().optional(),
          options: z.string().optional(),
        }),
      )
      .default([]),
    {
      label: 'Form Designer',
      editor: 'form-fields',
      description: 'Design the form fields interactively.',
    },
  ),
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
    case 'textarea':
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
          reason: 'Manual form fields can include secrets.',
          connectionType: { kind: 'primitive', name: 'secret' } as const,
        },
      };
    case 'list':
      return { schema: z.array(z.string()) };
    case 'enum':
      return { schema: z.string() };
    default:
      return {
        schema: z.unknown(),
        meta: {
          allowAny: true,
          reason: 'Manual form fields can return arbitrary JSON values.',
          connectionType: { kind: 'primitive', name: 'json' } as const,
        },
      };
  }
};

const definition = defineComponent({
  id: 'core.manual_action.form',
  label: 'Manual Form',
  category: 'manual_action',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Pauses workflow execution until a user fills out a form. Supports Markdown and dynamic context variables.',
  ui: {
    slug: 'manual-form',
    version: '1.3.0',
    type: 'process',
    category: 'manual_action',
    description: 'Collect structured data via a manual form. Supports dynamic context templates.',
    icon: 'FormInput',
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

    const outputShape: Record<string, z.ZodTypeAny> = {
      approved: port(z.boolean(), {
        label: 'Approved',
      }),
      respondedBy: port(z.string(), {
        label: 'Responded By',
      }),
    };

    // parse schema to get output ports
    if (Array.isArray(params.schema)) {
      for (const field of params.schema) {
        if (!field.id) continue;
        const { schema, meta } = mapTypeToSchema(field.type || 'string');
        outputShape[field.id] = port(schema, {
          ...(meta ?? {}),
          label: field.label || field.id,
        });
      }
    }

    return { inputs: inputs(inputShape), outputs: outputs(outputShape) };
  },
  async execute({ inputs, params }, context) {
    const titleTemplate = params.title || 'Form Input Required';
    const descriptionTemplate = params.description || '';
    const timeoutStr = params.timeout;
    const fields = params.schema || [];

    // Interpolate
    const contextData = { ...params, ...inputs };
    const title = interpolate(titleTemplate, contextData);
    const description = interpolate(descriptionTemplate, contextData);

    // Build JSON Schema from fields, with interpolation in labels/placeholders
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const field of fields) {
      if (!field.id) continue;

      const fieldLabel = interpolate(field.label || field.id, contextData);
      const fieldPlaceholder = interpolate(field.placeholder || '', contextData);
      const fieldDesc = interpolate(field.description || '', contextData);

      const type = field.type || 'string';
      const jsonProp: any = {
        title: fieldLabel,
        description: fieldPlaceholder || fieldDesc,
      };

      if (type === 'textarea') {
        jsonProp.type = 'string';
        jsonProp.format = 'textarea';
      } else if (type === 'enum') {
        jsonProp.type = 'string';
        const options = (field.options || '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        jsonProp.enum = options;
      } else if (type === 'number') {
        jsonProp.type = 'number';
      } else if (type === 'boolean') {
        jsonProp.type = 'boolean';
      } else {
        jsonProp.type = 'string';
      }

      properties[field.id] = jsonProp;
      if (field.required) {
        required.push(field.id);
      }
    }

    const schema = {
      type: 'object',
      properties,
      required,
    };

    // Measure timeout
    let timeoutAt: string | null = null;
    if (timeoutStr) {
      const timeout = parseTimeout(timeoutStr);
      if (timeout) {
        timeoutAt = new Date(Date.now() + timeout).toISOString();
      }
    }

    const requestId = `req-${context.runId}-${context.componentRef}`;

    context.logger.info(`[Manual Form] Created request: ${title}`);

    return {
      pending: true as const,
      requestId,
      inputType: 'form' as const,
      title,
      description,
      inputSchema: schema,
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
