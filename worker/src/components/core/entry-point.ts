import { z } from 'zod';
import {
  componentRegistry,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  withPortMeta,
} from '@shipsec/component-sdk';
import type { PortMeta } from '@shipsec/component-sdk/port-meta';

// Runtime input definition schema
const runtimeInputDefinitionSchema = z.preprocess(
  (value) => {
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
  },
  z.object({
    id: z.string().describe('Unique identifier for this input'),
    label: z.string().describe('Display label for the input field'),
    type: z
      .enum(['file', 'text', 'number', 'json', 'array', 'secret'])
      .describe('Type of input data'),
    required: z.boolean().default(true).describe('Whether this input is required'),
    description: z.string().optional().describe('Help text for the input'),
  }),
);

const inputSchema = inputs({
  // Runtime data will be injected at execution time.
  __runtimeData: port(z.record(z.string(), z.unknown()).optional(), {
    label: 'Runtime Data',
    editor: 'json',
    valuePriority: 'manual-first',
  }),
});

// EntryPoint has dynamic outputs based on runtimeInputs parameter
// We use an empty base schema and resolvePorts adds the actual outputs
const outputSchema = outputs({});

const parameterSchema = parameters({
  runtimeInputs: param(
    z
      .array(runtimeInputDefinitionSchema)
      .default([])
      .describe('Define inputs to collect when workflow is triggered'),
    {
      label: 'Runtime Inputs',
      editor: 'json',
      description: 'Define what data to collect when the workflow is triggered',
      placeholder: '[{"id":"myInput","label":"My Input","type":"text","required":true}]',
      helpText: 'Each input creates a corresponding output.',
    },
  ),
});

const definition = defineComponent({
  id: 'core.workflow.entrypoint',
  label: 'Entry Point',
  category: 'input',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Defines the workflow entry point. Configure runtime inputs to collect data (files, text, etc.) when the workflow is triggered.',
  ui: {
    slug: 'entry-point',
    version: '2.0.0',
    type: 'trigger',
    category: 'input',
    description:
      'Starts a workflow and captures runtime inputs from manual/API/scheduled invocations.',
    icon: 'Play',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    // Outputs are dynamic and determined by runtimeInputs parameter
    examples: [
      'Collect uploaded scope files or credentials before running security scans.',
      'Prompt operators for runtime parameters such as target domains or API keys.',
    ],
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const runtimeInputs = Array.isArray(params.runtimeInputs) ? params.runtimeInputs : [];

    const outputShape: Record<string, z.ZodTypeAny> = {};
    for (const input of runtimeInputs) {
      const id = typeof input?.id === 'string' ? input.id.trim() : '';
      if (!id) {
        continue;
      }

      const type = typeof input?.type === 'string' ? input.type.toLowerCase() : 'text';
      const required = input?.required !== undefined ? Boolean(input.required) : true;
      const label = typeof input?.label === 'string' ? input.label : id;
      const description = typeof input?.description === 'string' ? input.description : undefined;
      const { schema, meta } = runtimeInputTypeToSchema(type);
      const schemaWithRequirement = required ? schema : schema.optional();
      outputShape[id] = withPortMeta(schemaWithRequirement, {
        ...(meta ?? {}),
        label,
        description,
      });
    }

    return {
      inputs: inputSchema,
      outputs: outputs(outputShape),
    };
  },
  async execute({ inputs, params }, context) {
    // Type params properly from the parameter schema
    const runtimeInputs = params.runtimeInputs ?? [];
    const __runtimeData = inputs.__runtimeData;

    context.logger.info(
      `[EntryPoint] Executing with runtime inputs: ${JSON.stringify(runtimeInputs)}`,
    );

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
        throw new ValidationError(
          `Required runtime input '${inputDef.label}' (${inputDef.id}) was not provided`,
          {
            fieldErrors: { [inputDef.id]: ['This field is required'] },
          },
        );
      }
      outputs[inputDef.id] = value;
      // Mask secret values in logs
      const logValue =
        inputDef.type === 'secret'
          ? '***'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : value;
      context.logger.info(`[EntryPoint] Output '${inputDef.id}' = ${logValue}`);
    }

    context.emitProgress(`Collected ${Object.keys(outputs).length} runtime inputs`);
    return outputs;
  },
});

componentRegistry.register(definition);

// Export types - Output is dynamic so we use a record type
type EntryPointInput = typeof inputSchema;
type EntryPointParams = typeof parameterSchema;
type EntryPointOutput = typeof outputSchema;

export type { EntryPointInput, EntryPointParams, EntryPointOutput };

function runtimeInputTypeToSchema(type: string): { schema: z.ZodTypeAny; meta?: PortMeta } {
  switch (type) {
    case 'number':
      return { schema: z.number() };
    case 'boolean':
      return { schema: z.boolean() };
    case 'file':
      return {
        schema: z.string(),
        meta: { connectionType: { kind: 'primitive', name: 'file' } },
      };
    case 'json':
      return {
        schema: z.unknown(),
        meta: {
          allowAny: true,
          reason: 'Runtime JSON inputs can be arbitrary structures.',
          connectionType: { kind: 'primitive', name: 'json' },
        },
      };
    case 'array':
      return { schema: z.array(z.string()) };
    case 'secret':
      return {
        schema: z.string(),
        meta: { connectionType: { kind: 'primitive', name: 'secret' } },
      };
    case 'text':
    default:
      return { schema: z.string() };
  }
}
