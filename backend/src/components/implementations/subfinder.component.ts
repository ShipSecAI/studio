import { z } from 'zod';

import { componentRegistry } from '../registry';
import { ComponentDefinition } from '../types';

const inputSchema = z.object({
  domain: z.string(),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  subdomains: string[];
  rawOutput: string;
};

const outputSchema = z.object({
  subdomains: z.array(z.string()),
  rawOutput: z.string(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.subfinder.run',
  label: 'Subfinder',
  category: 'discovery',
  runner: { kind: 'docker', image: 'TODO/subfinder', command: [] },
  inputSchema,
  outputSchema,
  docs: 'Runs projectdiscovery/subfinder. Stubbed to return example subdomains.',
  async execute(params, context) {
    context.logger.info(`[Subfinder] scanning domain ${params.domain}`);
    context.emitProgress('Generating sample subdomains');
    return {
      subdomains: [`api.${params.domain}`, `app.${params.domain}`],
      rawOutput: `api.${params.domain}\napp.${params.domain}`,
    };
  },
};

componentRegistry.register(definition);
