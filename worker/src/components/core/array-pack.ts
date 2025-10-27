import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port } from '@shipsec/component-sdk';

const inputSchema = z.object({
  a: z.string().optional().describe('First value to include'),
  b: z.string().optional().describe('Second value to include'),
  c: z.string().optional().describe('Third value to include'),
  d: z.string().optional().describe('Fourth value to include'),
  e: z.string().optional().describe('Fifth value to include'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  items: z.array(z.string()),
  count: z.number().int(),
});

type Output = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.array.pack',
  label: 'Array Pack',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Collect up to five string inputs into an ordered array for downstream components such as Text Joiner.',
  metadata: {
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
    inputs: [
      { id: 'a', label: 'Item A', dataType: port.text(), description: 'First string input.' },
      { id: 'b', label: 'Item B', dataType: port.text(), description: 'Second string input.' },
      { id: 'c', label: 'Item C', dataType: port.text(), description: 'Third string input.' },
      { id: 'd', label: 'Item D', dataType: port.text(), description: 'Fourth string input.' },
      { id: 'e', label: 'Item E', dataType: port.text(), description: 'Fifth string input.' },
    ],
    outputs: [
      {
        id: 'items',
        label: 'Items',
        dataType: port.list(port.text()),
        description: 'Array of defined string inputs in order.',
      },
      {
        id: 'count',
        label: 'Count',
        dataType: port.number({ coerceFrom: [] }),
        description: 'Total number of strings packed.',
      },
    ],
  },
  async execute(params, context) {
    const entries: string[] = [];
    (['a', 'b', 'c', 'd', 'e'] as const).forEach((key) => {
      const value = params[key];
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
};

componentRegistry.register(definition);

