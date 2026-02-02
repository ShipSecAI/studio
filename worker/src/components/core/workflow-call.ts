import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  withPortMeta,
  coerceBooleanFromText,
  coerceNumberFromText,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import type { PortMeta } from '@shipsec/component-sdk/port-meta';

const runtimeInputDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().optional(),
    type: z.enum(['file', 'text', 'number', 'json', 'array', 'string']).optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strip();

const inputSchema = inputs({});

const parameterSchema = parameters({
  workflowId: param(z.string().uuid(), {
    label: 'Workflow',
    editor: 'select',
    description: 'The workflow to execute',
    options: [],
  }),
  versionStrategy: param(z.enum(['latest', 'specific']).default('latest'), {
    label: 'Version',
    editor: 'select',
    options: [
      { label: 'Latest', value: 'latest' },
      { label: 'Specific', value: 'specific' },
    ],
  }),
  versionId: param(z.string().uuid().optional(), {
    label: 'Specific Version ID',
    editor: 'text',
    description: 'Only used when versionStrategy is "specific"',
    visibleWhen: { versionStrategy: 'specific' },
  }),
  timeoutSeconds: param(z.number().int().positive().default(300), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 1,
  }),
  childRuntimeInputs: param(z.array(runtimeInputDefinitionSchema).optional(), {
    label: 'Child Runtime Inputs',
    editor: 'json',
    description: 'Internal configuration for child runtime input definitions.',
    visibleWhen: { __internal: true },
  }),
});

const outputSchema = outputs({
  result: port(z.record(z.string(), z.unknown()), {
    label: 'Result',
    allowAny: true,
    reason: 'Child workflows can return any shape.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  childRunId: port(z.string(), {
    label: 'Child Run ID',
  }),
});

const definition = defineComponent({
  id: 'core.workflow.call',
  label: 'Call Workflow',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Execute another workflow synchronously and use its outputs.',
  ui: {
    slug: 'workflow-call',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Execute another workflow synchronously and use its outputs.',
    icon: 'GitBranch',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    examples: ['Use a reusable enrichment workflow inside a larger pipeline.'],
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const parsed = parameterSchema.safeParse(params);
    const childRuntimeInputs = parsed.success ? (parsed.data.childRuntimeInputs ?? []) : [];
    const reservedIds = new Set([
      'workflowId',
      'versionStrategy',
      'versionId',
      'timeoutSeconds',
      'childRuntimeInputs',
      'childWorkflowName',
    ]);

    const inputShape: Record<string, z.ZodTypeAny> = {};
    for (const runtimeInput of childRuntimeInputs) {
      const id = runtimeInput.id.trim();
      if (!id || reservedIds.has(id)) {
        continue;
      }

      const label = runtimeInput.label?.trim() || id;
      const runtimeType = (runtimeInput.type ?? 'text').toLowerCase();
      const required = runtimeInput.required ?? true;
      const { schema, meta } = runtimeInputTypeToSchema(runtimeType);
      const schemaWithRequirement = required ? schema : schema.optional();
      inputShape[id] = withPortMeta(schemaWithRequirement, {
        ...(meta ?? {}),
        label,
        description: runtimeInput.description,
      });
    }

    return {
      inputs: inputs(inputShape),
      outputs: outputSchema,
    };
  },
  async execute() {
    throw new Error(
      'core.workflow.call must be executed by the Temporal workflow orchestrator (shipsecWorkflowRun)',
    );
  },
});

componentRegistry.register(definition);

function runtimeInputTypeToSchema(type: string): { schema: z.ZodTypeAny; meta?: PortMeta } {
  switch (type) {
    case 'string':
    case 'text':
      return { schema: z.string() };
    case 'number':
      return { schema: coerceNumberFromText() };
    case 'boolean':
      return { schema: coerceBooleanFromText() };
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
          reason: 'Child workflow runtime inputs can be arbitrary JSON.',
          connectionType: { kind: 'primitive', name: 'json' },
        },
      };
    case 'array':
      return { schema: z.array(z.string()) };
    default:
      return {
        schema: z.unknown(),
        meta: {
          allowAny: true,
          reason: 'Child workflow runtime inputs can be arbitrary JSON.',
          connectionType: { kind: 'any' },
        },
      };
  }
}
