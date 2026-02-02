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

// Support both direct text and file objects from entry point
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

const inputSchema = inputs({
  text: port(
    z
      .union([z.string(), manualTriggerFileSchema, fileLoaderFileSchema])
      .describe('Text content to split (string or file object)'),
    {
      label: 'Text Input',
      description:
        'Text content to be split into lines or items. Accepts either plain text string or file object with content property.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const outputSchema = outputs({
  items: port(z.array(z.string()), {
    label: 'Items',
    description: 'Array of strings after splitting.',
  }),
  count: port(z.number(), {
    label: 'Count',
    description: 'Number of items after splitting.',
  }),
});

const parameterSchema = parameters({
  separator: param(z.string().default('\n').describe('Separator to split by'), {
    label: 'Separator',
    editor: 'text',
    placeholder: '\\n',
    description: 'Character or string to split by (default: newline).',
    helpText: 'Use \\n for newline, \\t for tab, or any custom separator.',
  }),
});

const definition = defineComponent({
  id: 'core.text.splitter',
  label: 'Text Splitter',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Splits text into an array of strings based on a separator character or pattern.',
  ui: {
    slug: 'text-splitter',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Split text into array of strings by separator (newline, comma, etc.)',
    icon: 'SplitSquareHorizontal',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Split newline-delimited subdomains before enrichment components.',
      'Break CSV exports into individual entries for looping workflows.',
    ],
  },
  async execute({ inputs, params }, context) {
    context.logger.info(`[TextSplitter] Splitting text by separator: "${params.separator}"`);

    // Handle escape sequences
    const separator = params.separator
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');

    // Extract text content from input (handle three different input types)
    let textContent: string;
    if (typeof inputs.text === 'string') {
      // Case 1: Direct text input
      textContent = inputs.text;
      context.logger.info(
        `[TextSplitter] Processing direct text input (${textContent.length} characters)`,
      );
    } else if ('content' in inputs.text) {
      // Case 2: File object from file-loader (has base64 content)
      const base64Content = inputs.text.content;
      textContent = Buffer.from(base64Content, 'base64').toString('utf-8');
      context.logger.info(
        `[TextSplitter] Processing file-loader input: ${inputs.text.name} (${textContent.length} characters)`,
      );
    } else {
      // Case 3: File object from entry point (only metadata, no content)
      throw new ValidationError(
        `File object from entry point has no content. File ID: ${inputs.text.id}, Name: ${inputs.text.fileName}.
Please use a File Loader component to extract file content before passing to Text Splitter.
Expected workflow: Entry Point → File Loader → Text Splitter`,
        {
          fieldErrors: { text: ['File content is required - use File Loader first'] },
        },
      );
    }

    // Split the text
    const items = textContent
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
});

componentRegistry.register(definition);
