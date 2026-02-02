import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  ConfigurationError,
  ComponentRetryPolicy,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { LLMProviderSchema, type LlmProviderConfig } from '@shipsec/contracts';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_BASE_URL = process.env.GEMINI_BASE_URL ?? '';

const inputSchema = inputs({
  apiKey: port(
    z
      .string()
      .min(1, 'API key is required')
      .describe('Resolved Gemini API key supplied via a Secret Loader node.'),
    {
      label: 'API Key',
      description: 'Connect the Secret Loader output containing the Gemini API key.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
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

const parameterSchema = parameters({
  model: param(
    z.string().default(DEFAULT_MODEL).describe('Gemini model identifier (e.g., gemini-2.5-flash).'),
    {
      label: 'Model',
      editor: 'select',
      options: [
        { label: 'Gemini 3 Pro (Preview)', value: 'gemini-3-pro-preview' },
        { label: 'Gemini 3 Flash (Preview)', value: 'gemini-3-flash-preview' },
        { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
        { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
      ],
      description: 'Gemini model to emit.',
    },
  ),
  apiBaseUrl: param(
    z.string().default(DEFAULT_BASE_URL).describe('Optional override for the Gemini API base URL.'),
    {
      label: 'API Base URL',
      editor: 'text',
      description: 'Override for the Gemini API base URL (leave blank for default).',
    },
  ),
  projectId: param(
    z
      .string()
      .optional()
      .describe('Optional Google Cloud project identifier if required by the Gemini endpoint.'),
    {
      label: 'Project ID',
      editor: 'text',
      description: 'Optional Google Cloud project identifier if required by the Gemini endpoint.',
    },
  ),
});

// Retry policy for provider configuration - no retries needed for config validation
const geminiProviderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 1, // Provider config is deterministic, no retry needed
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.provider.gemini',
  label: 'Gemini Provider',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: geminiProviderRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Emits a Gemini provider configuration for downstream AI components.',
  ui: {
    slug: 'gemini-provider',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'Normalize Gemini credentials and model selection into a reusable provider config.',
    icon: 'Settings',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs, params }, context) {
    const { model, apiBaseUrl, projectId } = params;
    const { apiKey } = inputs;

    const effectiveApiKey = apiKey.trim();
    if (!effectiveApiKey) {
      throw new ConfigurationError('Gemini API key is required but was not provided.', {
        configKey: 'apiKey',
      });
    }

    const trimmedBaseUrl = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.GEMINI_BASE_URL;
    const trimmedProjectId = projectId?.trim();

    context.logger.info(`[GeminiProvider] Emitting config for model ${model}`);

    return {
      chatModel: {
        provider: 'gemini',
        modelId: model,
        apiKey: effectiveApiKey,
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(trimmedProjectId ? { projectId: trimmedProjectId } : {}),
      } satisfies LlmProviderConfig,
    };
  },
});

componentRegistry.register(definition);
