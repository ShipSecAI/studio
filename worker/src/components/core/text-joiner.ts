import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  ValidationError,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

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

const inputSchema = inputs({
  items: port(
    z
      .union([arrayInputSchema, z.string(), manualTriggerFileSchema, fileLoaderFileSchema])
      .describe('Array of strings to join (or single string)'),
    {
      label: 'Items',
      description:
        'Array of strings to join. Accepts array output from text-splitter or direct text input.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const outputSchema = outputs({
  text: port(z.string(), {
    label: 'Joined Text',
    description: 'Single string with all items joined by separator.',
  }),
  count: port(z.number(), {
    label: 'Count',
    description: 'Number of items that were joined.',
  }),
});

const parameterSchema = parameters({
  separator: param(z.string().default('\n').describe('Separator to join with'), {
    label: 'Separator',
    editor: 'text',
    placeholder: '\\n',
    description: 'Character or string to join items with (default: newline).',
    helpText: 'Use \\n for newline, \\t for tab, comma for CSV, or any custom separator.',
  }),
  prefix: param(z.string().default('').describe('Prefix to add to each item'), {
    label: 'Prefix',
    editor: 'text',
    placeholder: '',
    description: 'Text to add before each item.',
    helpText: 'Useful for bullet points: "- ", numbers: "1. ", etc.',
  }),
  suffix: param(z.string().default('').describe('Suffix to add to each item'), {
    label: 'Suffix',
    editor: 'text',
    placeholder: '',
    description: 'Text to add after each item.',
    helpText: 'Useful for adding punctuation or line breaks.',
  }),
});

const definition = defineComponent({
  id: 'core.text.joiner',
  label: 'Text Joiner',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Joins an array of strings into a single formatted string with optional prefix/suffix.',
  ui: {
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
    examples: [
      'Join array of domains into newline-separated list for AI analysis.',
      'Convert multiple text fragments into single prompt for processing.',
    ],
  },
  async execute({ inputs, params }, context) {
    context.logger.info(`[TextJoiner] Joining items with separator: "${params.separator}"`);

    // Handle different input types
    let itemsArray: string[];

    if (Array.isArray(inputs.items)) {
      // Case 1: Direct array input (from text-splitter)
      itemsArray = inputs.items;
      context.logger.info(`[TextJoiner] Processing array input (${itemsArray.length} items)`);
    } else if (typeof inputs.items === 'string') {
      // Case 2: String input - split by common separators
      itemsArray = inputs.items
        .split(/[\n,\r,;|]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      context.logger.info(`[TextJoiner] Split string input into ${itemsArray.length} items`);
    } else if ('content' in inputs.items) {
      // Case 3: File object from file-loader
      const base64Content = inputs.items.content;
      const textContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      itemsArray = textContent
        .split(/[\n,\r,;|]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      context.logger.info(
        `[TextJoiner] Processing file input: ${inputs.items.name} (${itemsArray.length} items)`,
      );
    } else {
      // Case 4: File object from entry point (no content)
      throw new ValidationError(
        `File object from entry point has no content. File ID: ${inputs.items.id}, Name: ${inputs.items.fileName}.
Please use a File Loader component to extract file content before passing to Text Joiner.
Expected workflow: Entry Point → File Loader → Text Joiner`,
        {
          fieldErrors: { items: ['File content is required - use File Loader first'] },
        },
      );
    }

    // Handle escape sequences
    const separator = params.separator
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');

    const prefix = params.prefix ?? '';
    const suffix = params.suffix ?? '';

    // Join items with prefix/suffix and separator
    const joinedText = itemsArray.map((item) => `${prefix}${item}${suffix}`).join(separator);

    context.logger.info(
      `[TextJoiner] Joined ${itemsArray.length} items into ${joinedText.length} characters`,
    );

    return {
      text: joinedText,
      count: itemsArray.length,
    };
  },
});

componentRegistry.register(definition);
