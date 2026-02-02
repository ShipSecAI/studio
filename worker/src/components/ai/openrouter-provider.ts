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

const DEFAULT_MODEL = 'openrouter/auto';
const DEFAULT_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER ?? '';
const DEFAULT_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'ShipSec Studio';

const inputSchema = inputs({
  apiKey: port(
    z
      .string()
      .min(1, 'API key is required')
      .describe('Resolved OpenRouter API key supplied via a Secret Loader node.'),
    {
      label: 'API Key',
      description: 'Connect the Secret Loader output containing the OpenRouter API key.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  model: param(
    z
      .string()
      .default(DEFAULT_MODEL)
      .describe(
        'OpenRouter model identifier (e.g., openrouter/auto, anthropic/claude-3.5-sonnet).',
      ),
    {
      label: 'Model',
      editor: 'text',
      description: 'OpenRouter model identifier to emit.',
    },
  ),
  apiBaseUrl: param(
    z
      .string()
      .default(DEFAULT_BASE_URL)
      .describe('Optional override for the OpenRouter API base URL.'),
    {
      label: 'API Base URL',
      editor: 'text',
      description:
        'Override for the OpenRouter API base URL (leave blank for the default provider URL).',
    },
  ),
  httpReferer: param(
    z
      .string()
      .default(DEFAULT_HTTP_REFERER)
      .describe('HTTP Referer header recommended by OpenRouter to identify your application.'),
    {
      label: 'HTTP Referer',
      editor: 'text',
      description: 'HTTP Referer header recommended by OpenRouter to identify your application.',
    },
  ),
  appTitle: param(
    z
      .string()
      .default(DEFAULT_APP_TITLE)
      .describe('X-Title header recommended by OpenRouter to describe your application.'),
    {
      label: 'App Title',
      editor: 'text',
      description: 'X-Title header recommended by OpenRouter to describe your application.',
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
const openrouterProviderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1, // Provider config is deterministic, no retry needed
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.provider.openrouter',
  label: 'OpenRouter Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: openrouterProviderRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Emits an OpenRouter provider configuration for downstream AI components.',
  ui: {
    slug: 'openrouter-provider',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'Normalize OpenRouter credentials, headers, and model selection into a reusable provider config.',
    icon: 'Settings',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs, params }, context) {
    const { model, apiBaseUrl, httpReferer, appTitle } = params;
    const { apiKey } = inputs;

    const effectiveApiKey = apiKey.trim();
    if (!effectiveApiKey) {
      throw new ConfigurationError('OpenRouter API key is required but was not provided.', {
        configKey: 'apiKey',
      });
    }

    const trimmedBaseUrl = apiBaseUrl?.trim() ? apiBaseUrl.trim() : DEFAULT_BASE_URL;

    const sanitizedHeaders: Record<string, string> = {};
    if (httpReferer?.trim()) {
      sanitizedHeaders['HTTP-Referer'] = httpReferer.trim();
    }
    if (appTitle?.trim()) {
      sanitizedHeaders['X-Title'] = appTitle.trim();
    }

    context.logger.info(`[OpenRouterProvider] Emitting config for model ${model}`);

    return {
      chatModel: {
        provider: 'openrouter',
        modelId: model,
        apiKey: effectiveApiKey,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(Object.keys(sanitizedHeaders).length > 0 ? { headers: sanitizedHeaders } : {}),
      } satisfies LlmProviderConfig,
    };
  },
});

componentRegistry.register(definition);
