import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port } from '@shipsec/component-sdk';

// Support both direct text and file objects from previous components
const manualTriggerFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  storageKey: z.string(),
  uploadedAt: z.string(),
});

// Support file objects from file-loader component
const fileLoaderFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  content: z.string(), // base64 encoded
});

// Support arrays from text-splitter
const arrayInputSchema = z.array(z.string());

const inputSchema = z.object({
  items: z.union([arrayInputSchema, z.string(), manualTriggerFileSchema, fileLoaderFileSchema]).describe('Array of strings to join (or single string)'),
  separator: z.string().default('\n').describe('Separator to join with'),
  prefix: z.string().default('').describe('Prefix to add to each item'),
  suffix: z.string().default('').describe('Suffix to add to each item'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  text: string;
  count: number;
};

const outputSchema = z.object({
  text: z.string(),
  count: z.number(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.text.joiner',
  label: 'Text Joiner',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Joins an array of strings into a single formatted string with optional prefix/suffix.',
  metadata: {
    slug: 'text-joiner',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Join array of strings into formatted text for AI prompts.',
    icon: 'Merge',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'items',
        label: 'Items',
        dataType: port.list(port.text()),
        required: true,
        description: 'Array of strings to join. Accepts array output from text-splitter or direct text input.',
      },
    ],
    outputs: [
      {
        id: 'text',
        label: 'Joined Text',
        dataType: port.text(),
        description: 'Single string with all items joined by separator.',
      },
      {
        id: 'count',
        label: 'Count',
        dataType: port.number({ coerceFrom: [] }),
        description: 'Number of items that were joined.',
      },
    ],
    examples: [
      'Join array of domains into newline-separated list for AI analysis.',
      'Convert multiple text fragments into single prompt for processing.',
    ],
    parameters: [
      {
        id: 'separator',
        label: 'Separator',
        type: 'text',
        required: false,
        default: '\\n',
        placeholder: '\\n',
        description: 'Character or string to join items with (default: newline).',
        helpText: 'Use \\n for newline, \\t for tab, comma for CSV, or any custom separator.',
      },
      {
        id: 'prefix',
        label: 'Prefix',
        type: 'text',
        required: false,
        default: '',
        placeholder: '',
        description: 'Text to add before each item.',
        helpText: 'Useful for bullet points: "- ", numbers: "1. ", etc.',
      },
      {
        id: 'suffix',
        label: 'Suffix',
        type: 'text',
        required: false,
        default: '',
        placeholder: '',
        description: 'Text to add after each item.',
        helpText: 'Useful for adding punctuation or line breaks.',
      },
    ],
  },
  async execute(params, context) {
    context.logger.info(`[TextJoiner] Joining items with separator: "${params.separator}"`);

    // Handle different input types
    let itemsArray: string[];

    if (Array.isArray(params.items)) {
      // Case 1: Direct array input (from text-splitter)
      itemsArray = params.items;
      context.logger.info(`[TextJoiner] Processing array input (${itemsArray.length} items)`);
    } else if (typeof params.items === 'string') {
      // Case 2: String input - split by common separators
      itemsArray = params.items
        .split(/[\n,\r,;|]+/)
        .map(item => item.trim())
        .filter(item => item.length > 0);
      context.logger.info(`[TextJoiner] Split string input into ${itemsArray.length} items`);
    } else if ('content' in params.items) {
      // Case 3: File object from file-loader
      const base64Content = params.items.content;
      const textContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      itemsArray = textContent
        .split(/[\n,\r,;|]+/)
        .map(item => item.trim())
        .filter(item => item.length > 0);
      context.logger.info(`[TextJoiner] Processing file input: ${params.items.name} (${itemsArray.length} items)`);
    } else {
      // Case 4: File object from entry point (no content)
      throw new Error(`File object from entry point has no content. File ID: ${params.items.id}, Name: ${params.items.fileName}.
Please use a File Loader component to extract file content before passing to Text Joiner.
Expected workflow: Entry Point → File Loader → Text Joiner`);
    }

    // Handle escape sequences
    const separator = params.separator
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');

    const prefix = params.prefix ?? '';
    const suffix = params.suffix ?? '';

    // Join items with prefix/suffix and separator
    const joinedText = itemsArray
      .map(item => `${prefix}${item}${suffix}`)
      .join(separator);

    context.logger.info(`[TextJoiner] Joined ${itemsArray.length} items into ${joinedText.length} characters`);

    return {
      text: joinedText,
      count: itemsArray.length,
    };
  },
};

componentRegistry.register(definition);
