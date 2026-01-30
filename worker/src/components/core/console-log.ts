import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { consoleLogResultSchema } from '@shipsec/contracts';

// Dynamic inputs will be injected here by resolvePorts
const inputSchema = inputs({});

const outputSchema = outputs({
  result: port(consoleLogResultSchema(), {
    label: 'Result',
    description: 'Confirmation that data was logged.',
  }),
  logged: port(z.boolean(), {
    label: 'Logged',
    description: 'Indicates whether the log entry was emitted.',
  }),
  preview: port(z.string(), {
    label: 'Preview',
    description: 'Short preview of the logged content.',
  }),
});

const parameterSchema = parameters({
  variables: param(
    z
      .array(
        z.object({
          name: z.string(),
          label: z.string().optional(),
        }),
      )
      .default([]),
    {
      label: 'Input Fields',
      editor: 'variable-list',
      description:
        'Define named input fields to log. Each field creates a port that can receive data from other components.',
    },
  ),
});

const definition = defineComponent({
  id: 'core.console.log',
  label: 'Console Log',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Logs data to workflow execution logs. Supports multiple named inputs for debugging and displaying results from different components.',
  ui: {
    slug: 'console-log',
    version: '2.0.0',
    type: 'output',
    category: 'output',
    description:
      'Output data to workflow execution logs for debugging and monitoring. Supports multiple named inputs.',
    icon: 'Terminal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Preview component output before wiring into external systems.',
      'Dump intermediate data structures while developing new workflows.',
      'Log multiple outputs from different components in a single node.',
    ],
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {
      // Always include a default 'data' input for simple use cases
      data: port(z.any().optional().describe('Data to log to console'), {
        label: 'Data',
        description: 'Any data to log (objects will be JSON stringified).',
        allowAny: true,
        reason: 'Console log accepts arbitrary payloads for debugging.',
      }),
      label: port(z.string().optional().describe('Optional label for the log entry'), {
        label: 'Label',
        description: 'Optional label to identify this log entry.',
      }),
    };

    // Add dynamic input ports based on variables parameter
    if (params.variables && Array.isArray(params.variables)) {
      for (const v of params.variables) {
        if (!v || !v.name) continue;
        // Use label if provided, otherwise use name
        const portLabel = v.label || v.name;
        inputShape[v.name] = port(z.any().optional(), {
          label: portLabel,
          description: `Data input: ${portLabel}`,
          allowAny: true,
          reason: 'Console log accepts arbitrary payloads for debugging.',
        });
      }
    }

    return { inputs: inputs(inputShape) };
  },
  async execute({ inputs, params }, context) {
    const inputData = inputs as Record<string, unknown>;
    const logLabel = (inputData.label as string) || 'Console Log';
    const variables = params.variables || [];

    context.logger.info(`[${logLabel}] ========================================`);

    const previews: string[] = [];

    // Helper to format and log data
    const formatData = (data: unknown): { formatted: string; preview: string } => {
      if (data === undefined || data === null) {
        return { formatted: 'null', preview: 'null' };
      }
      if (typeof data === 'object') {
        const formatted = JSON.stringify(data, null, 2);
        let preview: string;
        if (Array.isArray(data)) {
          preview = `Array with ${data.length} items`;
        } else {
          const keys = Object.keys(data);
          preview = `Object with ${keys.length} keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
        }
        return { formatted, preview };
      }
      const formatted = String(data);
      const preview = formatted.length > 100 ? formatted.substring(0, 100) + '...' : formatted;
      return { formatted, preview };
    };

    // Log the default 'data' input if provided
    if (inputData.data !== undefined) {
      const { formatted, preview } = formatData(inputData.data);
      context.logger.info(`[${logLabel}] [Data] ${formatted}`);
      previews.push(`Data: ${preview}`);
    }

    // Log each dynamic variable input
    for (const v of variables) {
      if (!v || !v.name) continue;
      const value = inputData[v.name];
      if (value !== undefined) {
        const displayLabel = v.label || v.name;
        const { formatted, preview } = formatData(value);
        context.logger.info(`[${logLabel}] [${displayLabel}] ${formatted}`);
        previews.push(`${displayLabel}: ${preview}`);
      }
    }

    context.logger.info(`[${logLabel}] ========================================`);

    // Create combined preview
    const combinedPreview = previews.length > 0 ? previews.join(' | ') : 'No data logged';

    // Emit progress with preview
    context.emitProgress(`Logged: ${combinedPreview}`);

    return {
      result: {
        logged: true,
        preview: combinedPreview,
      },
      logged: true,
      preview: combinedPreview,
    };
  },
});

componentRegistry.register(definition);
