import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  text: z.string().describe('Text content to split'),
  separator: z.string().default('\n').describe('Separator to split by'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  items: string[];
  count: number;
};

const outputSchema = z.object({
  items: z.array(z.string()),
  count: z.number(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.text.splitter',
  label: 'Text Splitter',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Splits text into an array of strings based on a separator character or pattern.',
  metadata: {
    slug: 'text-splitter',
    version: '1.0.0',
    type: 'process',
    category: 'building-block',
    description: 'Split text into array of strings by separator (newline, comma, etc.)',
    icon: 'SplitSquareHorizontal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'text',
        label: 'Text Input',
        type: 'string',
        required: true,
        description: 'Text content to be split into lines or items.',
      },
    ],
    outputs: [
      {
        id: 'items',
        label: 'Items',
        type: 'array',
        description: 'Array of strings after splitting.',
      },
      {
        id: 'count',
        label: 'Count',
        type: 'string',
        description: 'Number of items after splitting.',
      },
    ],
    parameters: [
      {
        id: 'separator',
        label: 'Separator',
        type: 'text',
        required: false,
        default: '\\n',
        placeholder: '\\n',
        description: 'Character or string to split by (default: newline).',
        helpText: 'Use \\n for newline, \\t for tab, or any custom separator.',
      },
    ],
  },
  async execute(params, context) {
    context.logger.info(`[TextSplitter] Splitting text by separator: "${params.separator}"`);

    // Handle escape sequences
    const separator = params.separator
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');

    // Split the text
    const items = params.text
      .split(separator)
      .map((item) => item.trim())
      .filter((item) => item.length > 0); // Remove empty strings

    context.logger.info(`[TextSplitter] Split into ${items.length} items`);
    context.emitProgress(`Split into ${items.length} items`);

    return {
      items,
      count: items.length,
    };
  },
};

componentRegistry.register(definition);

