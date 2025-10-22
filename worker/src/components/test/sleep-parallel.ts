import { z } from 'zod';
import { componentRegistry, type ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  delay: z.number().int().nonnegative().describe('Artificial delay in milliseconds'),
  label: z.string().describe('Label used for logs/emitted output'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  label: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
});

const definition: ComponentDefinition<Input, z.infer<typeof outputSchema>> = {
  id: 'test.sleep.parallel',
  label: 'Parallel Sleep (Test)',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Deterministic wait used for testing scheduler parallelism and benchmarking.',
  metadata: {
    slug: 'test-sleep-parallel',
    version: '1.0.0',
    type: 'process',
    category: 'building-block',
    description: 'Utility component that sleeps for a fixed delay and records timestamps.',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute(params, context) {
    const startedAt = Date.now();
    context.emitProgress({ level: 'debug', message: `Sleeping for ${params.delay}ms` });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, params.delay);
    });

    const endedAt = Date.now();
    context.emitProgress({
      level: 'debug',
      message: `Completed sleep in ${endedAt - startedAt}ms`,
    });

    return {
      label: params.label,
      startedAt,
      endedAt,
    };
  },
};

if (!componentRegistry.has(definition.id)) {
  componentRegistry.register(definition);
}
