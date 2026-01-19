import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  ValidationError,
  inputs,
  outputs,
  port,
  coerceNumberFromText,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  items: port(
    z
      .array(z.string())
      .min(1, 'Provide at least one item')
      .describe('Array of text values to pick from'),
    {
      label: 'Items',
      description: 'Array of strings to select from.',
    },
  ),
  index: port(
    coerceNumberFromText(z.number().int().min(0, 'Index must be zero or greater')).describe(
      'Zero-based index of the item to select',
    ),
    {
      label: 'Index',
      description: 'Zero-based index of the item to select.',
      valuePriority: 'manual-first',
    },
  ),
});

const outputSchema = outputs({
  value: port(z.string(), {
    label: 'Selected Value',
    description: 'The string value at the requested index.',
  }),
  index: port(z.number().int(), {
    label: 'Index',
    description: 'Index that was selected (echo).',
  }),
  total: port(z.number().int(), {
    label: 'Total Items',
    description: 'Total number of entries in the incoming array.',
  }),
});

const definition = defineComponent({
  id: 'core.array.pick',
  label: 'Array Item Picker',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Selects a single item from an array by index. Use after splitting text to route specific elements into downstream components.',
  ui: {
    slug: 'array-pick',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description:
      'Pick a specific item from an array produced by Text Splitter or other components.',
    icon: 'MousePointerSquare',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute({ inputs }, context) {
    const { items, index } = inputs;

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
});

componentRegistry.register(definition);
