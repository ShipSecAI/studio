import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

// Runtime input definition schema
const runtimeInputDefinitionSchema = z.object({
  id: z.string().describe('Unique identifier for this input'),
  label: z.string().describe('Display label for the input field'),
  type: z.enum(['file', 'text', 'number', 'json', 'array']).describe('Type of input data'),
  required: z.boolean().default(true).describe('Whether this input is required'),
  description: z.string().optional().describe('Help text for the input'),
});

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
  id: 'core.trigger.manual',
  label: 'Manual Trigger',
  category: 'trigger',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Acts as the workflow entrypoint. Configure runtime inputs to collect data (files, text, etc.) when the workflow is triggered.',
  metadata: {
    slug: 'manual-trigger',
    version: '2.0.0',
    type: 'trigger',
    category: 'trigger',
    description: 'Starts a workflow manually. Configure runtime inputs to collect data when triggered.',
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
  async execute(params, context) {
    const { runtimeInputs, __runtimeData } = params;
    
    context.logger.info(`[ManualTrigger] Executing with runtime inputs: ${JSON.stringify(runtimeInputs)}`);
    
    // If no runtime inputs defined, return empty object
    if (!runtimeInputs || runtimeInputs.length === 0) {
      context.logger.info('[ManualTrigger] No runtime inputs configured, returning empty output');
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
      context.logger.info(`[ManualTrigger] Output '${inputDef.id}' = ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }

    context.emitProgress(`Collected ${Object.keys(outputs).length} runtime inputs`);
    return outputs;
  },
};

componentRegistry.register(definition);

