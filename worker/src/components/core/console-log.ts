import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  registerContract,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  data: z.any().describe('Data to log to console'),
  label: z.string().optional().describe('Optional label for the log entry'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  logged: boolean;
  preview: string;
};

const outputSchema = z.object({
  logged: z.boolean(),
  preview: z.string(),
});

const CONSOLE_RESULT_CONTRACT = 'core.console-log.result.v1';

registerContract({
  name: CONSOLE_RESULT_CONTRACT,
  schema: outputSchema,
  summary: 'Console log execution result payload',
  description:
    'Confirms that the Console Log component emitted data, including a preview string for UI display.',
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.console.log',
  label: 'Console Log',
  category: 'output',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Logs data to workflow execution logs. Useful for debugging and displaying results.',
  metadata: {
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
    inputs: [
      {
        id: 'data',
        label: 'Data',
        dataType: port.any(),
        required: true,
        description: 'Any data to log (objects will be JSON stringified).',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'Result',
        dataType: port.contract(CONSOLE_RESULT_CONTRACT),
        description: 'Confirmation that data was logged.',
      },
    ],
    examples: [
      'Preview component output before wiring into external systems.',
      'Dump intermediate data structures while developing new workflows.',
    ],
    parameters: [
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        required: false,
        placeholder: 'My Log',
        description: 'Optional label to identify this log entry.',
        helpText: 'Helps identify logs when multiple console log components are used.',
      },
    ],
  },
  async execute(params, context) {
    const label = params.label || 'Console Log';
    
    context.logger.info(`[${label}] ========================================`);

    // Format the data for logging
    let formattedData: string;
    let preview: string;

    if (typeof params.data === 'object' && params.data !== null) {
      formattedData = JSON.stringify(params.data, null, 2);
      
      // Create a preview (first 200 chars)
      if (Array.isArray(params.data)) {
        preview = `Array with ${params.data.length} items`;
      } else {
        const keys = Object.keys(params.data);
        preview = `Object with ${keys.length} keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
      }
    } else {
      formattedData = String(params.data);
      preview = formattedData.length > 100 ? formattedData.substring(0, 100) + '...' : formattedData;
    }

    // Log to workflow execution logs
    context.logger.info(`[${label}] ${formattedData}`);
    context.logger.info(`[${label}] ========================================`);

    // Emit progress with preview
    context.emitProgress(`Logged: ${preview}`);

    return {
      logged: true,
      preview,
    };
  },
};

componentRegistry.register(definition);
