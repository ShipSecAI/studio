import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { LLMProviderSchema, type LlmProviderConfig } from '@shipsec/contracts';

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? '';

const inputSchema = inputs({
  apiKey: port(
    z
      .string()
      .min(1, 'API key is required')
      .describe('Resolved OpenAI-compatible API key supplied via a Secret Loader node.'),
    {
      label: 'API Key',
      description: 'Connect the Secret Loader output containing the OpenAI-compatible API key.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  model: param(
    z.string().default(DEFAULT_MODEL).describe('OpenAI compatible chat model identifier.'),
    {
      label: 'Model',
      editor: 'select',
      options: [
        { label: 'GPT-5.2', value: 'gpt-5.2' },
        { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
        { label: 'GPT-5.1', value: 'gpt-5.1' },
        { label: 'GPT-5', value: 'gpt-5' },
        { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
      ],
      description: 'OpenAI compatible chat model to emit.',
    },
  ),
  apiBaseUrl: param(
    z
      .string()
      .default(DEFAULT_BASE_URL)
      .describe('Optional override for the OpenAI-compatible API base URL.'),
    {
      label: 'API Base URL',
      editor: 'text',
      description:
        'Override for the OpenAI-compatible API base URL (leave blank for the default provider URL).',
    },
  ),
  headers: param(
    z
      .record(z.string(), z.string())
      .optional()
      .describe('Optional HTTP headers included when invoking the model.'),
    {
      label: 'Headers',
      editor: 'json',
      description: 'Optional HTTP headers included when invoking the model.',
    },
  ),
});

const outputSchema = outputs({
  chatModel: port(LLMProviderSchema(), {
    label: 'LLM Provider Config',
    description:
      'Portable provider payload (provider, model, overrides) for wiring into AI Agent or one-shot nodes.',
  }),
});

// Retry policy for provider configuration - no retries needed for config validation
const openaiProviderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1, // Provider config is deterministic, no retry needed
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.provider.openai',
  label: 'OpenAI Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: openaiProviderRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Emits a reusable OpenAI provider configuration that downstream AI components can consume.',
  ui: {
    slug: 'openai-provider',
    version: '1.1.0',
    type: 'process',
    category: 'ai',
    description:
      'Normalize OpenAI credentials, base URL, and model selection into a portable provider config.',
    icon: 'Settings',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs, params }, context) {
    const { model, apiBaseUrl, headers } = params;
    const { apiKey } = inputs;

    const effectiveApiKey = apiKey.trim();
    if (!effectiveApiKey) {
      throw new ConfigurationError('OpenAI API key is required but was not provided.', {
        configKey: 'apiKey',
      });
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
      } satisfies LlmProviderConfig,
    };
  },
});

componentRegistry.register(definition);
