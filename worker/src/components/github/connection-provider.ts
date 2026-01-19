import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({});

const parameterSchema = parameters({
  connectionId: param(
    z
      .string()
      .trim()
      .min(1, 'Select a GitHub connection to share downstream.')
      .describe('Existing GitHub connection ID.'),
    {
      label: 'GitHub Connection',
      editor: 'text',
      description: 'Pick an existing GitHub connection to provide to downstream steps.',
      helpText:
        'Connections are created via the Connections page. Selection is stored securely and tokens stay server-side.',
    },
  ),
});

export type GitHubConnectionProviderInput = typeof inputSchema;
export type GitHubConnectionProviderParams = typeof parameterSchema;

const outputSchema = outputs({
  connectionId: port(z.string(), {
    label: 'GitHub Connection ID',
    description: 'Selected GitHub connection identifier. Wire this into GitHub components.',
  }),
});

export type GitHubConnectionProviderOutput = typeof outputSchema;

const definition = defineComponent({
  id: 'github.connection.provider',
  label: 'GitHub Connection Provider',
  category: 'input',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Expose a selected GitHub integration connection so downstream components can reuse its OAuth token.',
  ui: {
    slug: 'github-connection-provider',
    version: '1.0.0',
    type: 'input',
    category: 'it_ops',
    description:
      'Surface a GitHub integration connection to downstream automation steps without re-entering OAuth credentials.',
    icon: 'Plug',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Use this before GitHub removal steps to consistently reuse the same OAuth connection.',
    ],
  },
  async execute({ params }, context) {
    const trimmedConnectionId = params.connectionId.trim();

    context.logger.info(
      `[GitHub] Providing connection ${trimmedConnectionId} to downstream nodes.`,
    );
    context.emitProgress(`Selected GitHub connection ${trimmedConnectionId}.`);

    return outputSchema.parse({
      connectionId: trimmedConnectionId,
    });
  },
});

componentRegistry.register(definition);
