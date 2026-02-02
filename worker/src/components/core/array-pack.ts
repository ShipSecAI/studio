import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';

const inputSchema = inputs({
  a: port(z.string().optional().describe('First value to include'), {
    label: 'Item A',
    description: 'First string input.',
  }),
  b: port(z.string().optional().describe('Second value to include'), {
    label: 'Item B',
    description: 'Second string input.',
  }),
  c: port(z.string().optional().describe('Third value to include'), {
    label: 'Item C',
    description: 'Third string input.',
  }),
  d: port(z.string().optional().describe('Fourth value to include'), {
    label: 'Item D',
    description: 'Fourth string input.',
  }),
  e: port(z.string().optional().describe('Fifth value to include'), {
    label: 'Item E',
    description: 'Fifth string input.',
  }),
});

const outputSchema = outputs({
  items: port(z.array(z.string()), {
    label: 'Items',
    description: 'Array of defined string inputs in order.',
  }),
  count: port(z.number().int(), {
    label: 'Count',
    description: 'Total number of strings packed.',
  }),
});

const definition = defineComponent({
  id: 'core.array.pack',
  label: 'Array Pack',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Collect up to five string inputs into an ordered array for downstream components such as Text Joiner.',
  ui: {
    slug: 'array-pack',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Combine multiple string inputs into an array.',
    icon: 'ListCollapse',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute({ inputs }, context) {
    const entries: string[] = [];
    (['a', 'b', 'c', 'd', 'e'] as const).forEach((key) => {
      const value = inputs[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        entries.push(value);
      }
    });

    context.logger.info(`[ArrayPack] Packed ${entries.length} item(s).`);

    return {
      items: entries,
      count: entries.length,
    };
  },
});

componentRegistry.register(definition);
