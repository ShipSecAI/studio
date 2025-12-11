import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port } from '@shipsec/component-sdk';

// Runtime input definition schema
const runtimeInputDefinitionSchema = z.preprocess((value) => {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const typed = value as Record<string, unknown>;
    if (typed.type === 'string') {
      return {
        ...typed,
        type: 'text',
      };
    }
  }
  return value;
}, z.object({
  id: z.string().describe('Unique identifier for this input'),
  label: z.string().describe('Display label for the input field'),
  type: z.enum(['file', 'text', 'number', 'json', 'array']).describe('Type of input data'),
  required: z.boolean().default(true).describe('Whether this input is required'),
  description: z.string().optional().describe('Help text for the input'),
}));

const inputSchema = z.object({
  runtimeInputs: z.array(runtimeInputDefinitionSchema).default([]).describe('Define inputs to collect when workflow is triggered'),
  // Runtime data will be merged with this at execution time
  __runtimeData: z.record(z.string(), z.unknown()).optional(),
});

type Input = z.infer<typeof inputSchema>;

// Output is dynamic based on runtimeInputs configuration
type Output = Record<string, unknown>;

const outputSchema = z.record(z.string(), z.unknown());

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.workflow.entrypoint',
  label: 'Entry Point',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Defines the workflow entry point. Configure runtime inputs to collect data (files, text, etc.) when the workflow is triggered.',
  metadata: {
    slug: 'entry-point',
    version: '2.0.0',
    type: 'trigger',
    category: 'input',
    description: 'Starts a workflow and captures runtime inputs from manual/API/scheduled invocations.',
    icon: 'Play',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [],
    // Outputs are dynamic and determined by runtimeInputs parameter
    outputs: [],
    examples: [
      'Collect uploaded scope files or credentials before running security scans.',
      'Prompt operators for runtime parameters such as target domains or API keys.',
    ],
    parameters: [
      {
        id: 'runtimeInputs',
        label: 'Runtime Inputs',
        type: 'json',
        required: false,
        default: [],
        description: 'Define what data to collect when the workflow is triggered',
        helpText: 'Each input creates a corresponding output. Example: [{"id":"uploadedFile","label":"Input File","type":"file","required":true}]',
        placeholder: '[{"id":"myInput","label":"My Input","type":"text","required":true}]',
      },
    ],
  },
  resolvePorts(params) {
    const runtimeInputs = Array.isArray(params.runtimeInputs)
      ? params.runtimeInputs
      : [];

    const outputs = runtimeInputs
      .map((input: any) => {
        const id = typeof input?.id === 'string' ? input.id.trim() : '';
        if (!id) {
          return null;
        }

        const type = typeof input?.type === 'string' ? input.type.toLowerCase() : 'text';
        return {
          id,
          label: typeof input?.label === 'string' ? input.label : id,
          required: input?.required !== undefined ? Boolean(input.required) : true,
          description: typeof input?.description === 'string' ? input.description : undefined,
          dataType: runtimeInputTypeToPort(type),
        };
      })
      .filter((portMeta): portMeta is NonNullable<typeof portMeta> => portMeta !== null);

    return {
      inputs: [],
      outputs,
    };
  },
  async execute(params, context) {
    const { runtimeInputs, __runtimeData } = params;
    context.logger.info(`[EntryPoint] Executing with runtime inputs: ${JSON.stringify(runtimeInputs)}`);
    
    // If no runtime inputs defined, return empty object
    if (!runtimeInputs || runtimeInputs.length === 0) {
      context.logger.info('[EntryPoint] No runtime inputs configured, returning empty output');
      return {};
    }

    // Map runtime data to outputs based on runtimeInputs configuration
    const outputs: Record<string, unknown> = {};
    
    for (const inputDef of runtimeInputs) {
      const value = __runtimeData?.[inputDef.id];
      
      if (inputDef.required && (value === undefined || value === null)) {
        throw new Error(`Required runtime input '${inputDef.label}' (${inputDef.id}) was not provided`);
      }
      outputs[inputDef.id] = value;
      context.logger.info(`[EntryPoint] Output '${inputDef.id}' = ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }

    context.emitProgress(`Collected ${Object.keys(outputs).length} runtime inputs`);
    return outputs;
  },
};

componentRegistry.register(definition);

export type { Input as EntryPointInput, Output as EntryPointOutput };

function runtimeInputTypeToPort(type: string) {
  switch (type) {
    case 'number':
      return port.number({ coerceFrom: ['text'] });
    case 'boolean':
      return port.boolean({ coerceFrom: ['text'] });
    case 'file':
      return port.file();
    case 'json':
      return port.json();
    case 'array':
      return port.list(port.text());
    case 'secret':
      return port.secret();
    case 'text':
    default:
      return port.text();
  }
}
