import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port, ValidationError } from '@shipsec/component-sdk';

const inputSchema = z.object({
  items: z.array(z.string()).min(1, 'Provide at least one item').describe('Array of text values to pick from'),
  index: z
    .number()
    .int()
    .min(0, 'Index must be zero or greater')
    .describe('Zero-based index of the item to select'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  value: z.string(),
  index: z.number().int(),
  total: z.number().int(),
});

type Output = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.array.pick',
  label: 'Array Item Picker',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Selects a single item from an array by index. Use after splitting text to route specific elements into downstream components.',
  metadata: {
    slug: 'array-pick',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Pick a specific item from an array produced by Text Splitter or other components.',
    icon: 'MousePointerSquare',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    inputs: [
      {
        id: 'items',
        label: 'Items',
        dataType: port.list(port.text()),
        required: true,
        description: 'Array of strings to select from.',
      },
      {
        id: 'index',
        label: 'Index',
        dataType: port.number({ coerceFrom: ['text'] }),
        valuePriority: 'manual-first',
        required: true,
        description: 'Zero-based index of the item to select.',
      },
    ],
    outputs: [
      {
        id: 'value',
        label: 'Selected Value',
        dataType: port.text(),
        description: 'The string value at the requested index.',
      },
      {
        id: 'index',
        label: 'Index',
        dataType: port.number({ coerceFrom: [] }),
        description: 'Index that was selected (echo).',
      },
      {
        id: 'total',
        label: 'Total Items',
        dataType: port.number({ coerceFrom: [] }),
        description: 'Total number of entries in the incoming array.',
      },
    ],
    parameters: [
      {
        id: 'index',
        label: 'Index',
        type: 'number',
        required: true,
        default: 0,
        min: 0,
        description: 'Which entry to extract (zero-based).',
      },
    ],
  },
  async execute(params, context) {
    const { items, index } = params;

    if (index < 0 || index >= items.length) {
      throw new ValidationError(
        `Requested index ${index} is out of bounds for array with ${items.length} items.`,
        { fieldErrors: { index: [`Must be between 0 and ${items.length - 1}`] } },
      );
    }

    const value = items[index];

    context.logger.info(
      `[ArrayPick] Selected item ${index + 1}/${items.length}: ${value.slice(0, 80)}`,
    );

    return {
      value,
      index,
      total: items.length,
    };
  },
};

componentRegistry.register(definition);
