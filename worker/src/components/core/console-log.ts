import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
} from '@shipsec/component-sdk';
import { consoleLogResultSchema } from '@shipsec/contracts';

const inputSchema = inputs({
  data: port(z.any().describe('Data to log to console'), {
    label: 'Data',
    description: 'Any data to log (objects will be JSON stringified).',
    allowAny: true,
    reason: 'Console log accepts arbitrary payloads for debugging.',
  }),
  label: port(z.string().optional().describe('Optional label for the log entry'), {
    label: 'Label',
    description: 'Optional label to identify this log entry.',
  }),
});

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

const parameterSchema = parameters({});

const definition = defineComponent({
  id: 'core.console.log',
  label: 'Console Log',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Logs data to workflow execution logs. Useful for debugging and displaying results.',
  ui: {
    slug: 'console-log',
    version: '1.0.0',
    type: 'output',
    category: 'output',
    description: 'Output data to workflow execution logs for debugging and monitoring.',
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
    ],
  },
  async execute({ inputs, params: _params }, context) {
    const label = inputs.label || 'Console Log';

    context.logger.info(`[${label}] ========================================`);

    // Format the data for logging
    let formattedData: string;
    let preview: string;

    if (typeof inputs.data === 'object' && inputs.data !== null) {
      formattedData = JSON.stringify(inputs.data, null, 2);

      // Create a preview (first 200 chars)
      if (Array.isArray(inputs.data)) {
        preview = `Array with ${inputs.data.length} items`;
      } else {
        const keys = Object.keys(inputs.data);
        preview = `Object with ${keys.length} keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
      }
    } else {
      formattedData = String(inputs.data);
      preview =
        formattedData.length > 100 ? formattedData.substring(0, 100) + '...' : formattedData;
    }

    // Log to workflow execution logs
    context.logger.info(`[${label}] ${formattedData}`);
    context.logger.info(`[${label}] ========================================`);

    // Emit progress with preview
    context.emitProgress(`Logged: ${preview}`);

    return {
      result: {
        logged: true,
        preview,
      },
      logged: true,
      preview,
    };
  },
});

componentRegistry.register(definition);
