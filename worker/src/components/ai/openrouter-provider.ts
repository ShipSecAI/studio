import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  ConfigurationError,
  ComponentRetryPolicy,
} from '@shipsec/component-sdk';
import { llmProviderContractName, LLMProviderSchema } from './chat-model-contract';

const DEFAULT_MODEL = 'openrouter/auto';
const DEFAULT_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER ?? '';
const DEFAULT_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'ShipSec Studio';

const inputSchema = z.object({
  model: z
    .string()
    .default(DEFAULT_MODEL)
    .describe('OpenRouter model identifier (e.g., openrouter/auto, anthropic/claude-3.5-sonnet).'),
  apiBaseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .describe('Optional override for the OpenRouter API base URL.'),
  apiKey: z
    .string()
    .min(1, 'API key is required')
    .describe('Resolved OpenRouter API key supplied via a Secret Loader node.'),
  httpReferer: z
    .string()
    .default(DEFAULT_HTTP_REFERER)
    .describe('HTTP Referer header recommended by OpenRouter to identify your application.'),
  appTitle: z
    .string()
    .default(DEFAULT_APP_TITLE)
    .describe('X-Title header recommended by OpenRouter to describe your application.'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  chatModel: LLMProviderSchema,
});

type Output = z.infer<typeof outputSchema>;

// Retry policy for provider configuration - no retries needed for config validation
const openrouterProviderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1, // Provider config is deterministic, no retry needed
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.provider.openrouter',
  label: 'OpenRouter Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: openrouterProviderRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Emits an OpenRouter provider configuration for downstream AI components.',
  metadata: {
    slug: 'openrouter-provider',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'Normalize OpenRouter credentials, headers, and model selection into a reusable provider config.',
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
        description: 'Connect the Secret Loader output containing the OpenRouter API key.',
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
        type: 'text',
        required: true,
        default: DEFAULT_MODEL,
        description: 'OpenRouter model identifier to emit.',
      },
      {
        id: 'apiBaseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        default: DEFAULT_BASE_URL,
        description: 'Override for the OpenRouter API base URL (leave blank for the default provider URL).',
      },
      {
        id: 'httpReferer',
        label: 'HTTP Referer',
        type: 'text',
        required: false,
        default: DEFAULT_HTTP_REFERER,
        description: 'HTTP Referer header recommended by OpenRouter to identify your application.',
      },
      {
        id: 'appTitle',
        label: 'App Title',
        type: 'text',
        required: false,
        default: DEFAULT_APP_TITLE,
        description: 'X-Title header recommended by OpenRouter to describe your application.',
      },
    ],
  },
  async execute(params, context) {
    const { model, apiBaseUrl, apiKey, httpReferer, appTitle } = params;

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
      } satisfies z.infer<typeof LLMProviderSchema>,
    };
  },
};

componentRegistry.register(definition);
