import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
} from '@shipsec/component-sdk';
import { llmProviderContractName, LLMProviderSchema } from './chat-model-contract';

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? '';

const inputSchema = z.object({
  model: z
    .string()
    .default(DEFAULT_MODEL)
    .describe('OpenAI compatible chat model identifier.'),
  apiBaseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .describe('Optional override for the OpenAI-compatible API base URL.'),
  apiKey: z
    .string()
    .min(1, 'API key is required')
    .describe('Resolved OpenAI-compatible API key supplied via a Secret Loader node.'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional HTTP headers included when invoking the model.'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  chatModel: LLMProviderSchema,
});

type Output = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.provider.openai',
  label: 'OpenAI Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Emits a reusable OpenAI provider configuration that downstream AI components can consume.',
  metadata: {
    slug: 'openai-provider',
    version: '1.1.0',
    type: 'process',
    category: 'ai',
    description: 'Normalize OpenAI credentials, base URL, and model selection into a portable provider config.',
    icon: 'Settings',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'apiKey',
        label: 'API Key',
        dataType: port.secret(),
        required: true,
        description: 'Connect the Secret Loader output containing the OpenAI-compatible API key.',
      },
    ],
    outputs: [
      {
        id: 'chatModel',
        label: 'LLM Provider Config',
        dataType: port.credential(llmProviderContractName),
        description:
          'Portable provider payload (provider, model, overrides) for wiring into AI Agent or one-shot nodes.',
      },
    ],
    parameters: [
      {
        id: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        default: DEFAULT_MODEL,
        description: 'OpenAI compatible chat model to emit.',
        options: [
          { label: 'GPT-5.2', value: 'gpt-5.2' },
          { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
          { label: 'GPT-5.1', value: 'gpt-5.1' },
          { label: 'GPT-5', value: 'gpt-5' },
          { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
        ],
      },
      {
        id: 'apiBaseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        default: DEFAULT_BASE_URL,
        description:
          'Override for the OpenAI-compatible API base URL (leave blank for the default provider URL).',
      },
    ],
  },
  async execute(params, context) {
    const { model, apiBaseUrl, apiKey, headers } = params;

    const effectiveApiKey = apiKey.trim();
    if (!effectiveApiKey) {
      throw new Error('OpenAI API key is required but was not provided.');
    }

    const trimmedBaseUrl = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.OPENAI_BASE_URL;

    const sanitizedHeaders =
      headers && Object.keys(headers).length > 0
        ? Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
            const trimmedKey = key.trim();
            const trimmedValue = value.trim();
            if (trimmedKey.length > 0 && trimmedValue.length > 0) {
              acc[trimmedKey] = trimmedValue;
            }
            return acc;
          }, {})
        : undefined;

    context.logger.info(`[OpenAIProvider] Emitting config for model ${model}`);

    return {
      chatModel: {
        provider: 'openai',
        modelId: model,
        apiKey: effectiveApiKey,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(sanitizedHeaders ? { headers: sanitizedHeaders } : {}),
      } satisfies z.infer<typeof LLMProviderSchema>,
    };
  },
};

componentRegistry.register(definition);
