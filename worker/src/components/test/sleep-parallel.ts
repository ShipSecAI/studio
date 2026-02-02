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

const inputSchema = inputs({});

const parameterSchema = parameters({
  delay: param(z.number().int().nonnegative().describe('Artificial delay in milliseconds'), {
    label: 'Delay',
    editor: 'number',
    description: 'Artificial delay in milliseconds.',
    min: 0,
  }),
  label: param(z.string().describe('Label used for logs/emitted output'), {
    label: 'Label',
    editor: 'text',
    description: 'Label used for logs/emitted output.',
  }),
});

const outputSchema = outputs({
  label: port(z.string(), {
    label: 'Label',
    description: 'Label emitted by the component.',
  }),
  startedAt: port(z.number(), {
    label: 'Started At',
    description: 'Timestamp when the sleep started.',
  }),
  endedAt: port(z.number(), {
    label: 'Ended At',
    description: 'Timestamp when the sleep ended.',
  }),
});

const definition = defineComponent({
  id: 'test.sleep.parallel',
  label: 'Parallel Sleep (Test)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Deterministic wait used for testing scheduler parallelism and benchmarking.',
  ui: {
    slug: 'test-sleep-parallel',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Utility component that sleeps for a fixed delay and records timestamps.',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const startedAt = Date.now();
    context.emitProgress({ level: 'debug', message: `Sleeping for ${parsedParams.delay}ms` });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, parsedParams.delay);
    });

    const endedAt = Date.now();
    context.emitProgress({
      level: 'debug',
      message: `Completed sleep in ${endedAt - startedAt}ms`,
    });

    return {
      label: parsedParams.label,
      startedAt,
      endedAt,
    };
  },
});

if (!componentRegistry.has(definition.id)) {
  componentRegistry.register(definition);
}

// Create local type aliases for backward compatibility
type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as SleepParallelInput, Output as SleepParallelOutput };
