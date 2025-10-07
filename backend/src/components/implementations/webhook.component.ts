import { z } from 'zod';

import { componentRegistry } from '../registry';
import { ComponentDefinition } from '../types';

const inputSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.string(), z.unknown()),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  status: 'sent';
};

const outputSchema = z.object({
  status: z.literal('sent'),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.webhook.post',
  label: 'Webhook',
  category: 'output',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Sends payload to an external webhook. Stubbed to log payload.',
  async execute(params, context) {
    context.logger.info(`[Webhook] would POST to ${params.url}`);
    context.emitProgress('Webhook dispatched (stub)');
    context.logger.info(JSON.stringify(params.payload));
    return { status: 'sent' };
  },
};

componentRegistry.register(definition);
