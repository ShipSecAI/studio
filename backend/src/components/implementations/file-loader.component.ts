import { z } from 'zod';

import { componentRegistry } from '../registry';
import { ComponentDefinition } from '../types';

const inputSchema = z.object({
  fileName: z.string().default('sample.txt'),
  content: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  fileName: string;
  mimeType: string;
  content: string; // base64 encoded for downstream components
};

const outputSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.file.loader',
  label: 'File Loader',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Loads file content. For now returns stubbed data when no content is provided.',
  async execute(params, context) {
    context.logger.info(`[FileLoader] loading file ${params.fileName}`);
    const content = params.content ?? 'SGVsbG8sIFNoaXBTZWMh';
    context.emitProgress('File content resolved');
    return {
      fileName: params.fileName,
      mimeType: 'text/plain',
      content,
    };
  },
};

componentRegistry.register(definition);
