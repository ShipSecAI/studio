import { z } from 'zod';
import { generateText as generateTextImpl } from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

// Define types for dependencies to enable dependency injection for testing
export type GenerateTextFn = typeof generateTextImpl;
export type CreateOpenAIFn = typeof createOpenAIImpl;

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL ?? '';

const inputSchema = z.object({
  systemPrompt: z
    .string()
    .default('')
    .describe('Optional system message to steer the assistant behaviour.'),
  userPrompt: z
    .string()
    .min(1, 'User prompt cannot be empty')
    .describe('Primary user prompt sent to the assistant.'),
  model: z
    .string()
    .default(DEFAULT_MODEL)
    .describe('OpenAI compatible chat model identifier.'),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(DEFAULT_TEMPERATURE)
    .describe('Sampling temperature for the response (0-2).'),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .max(4096)
    .default(DEFAULT_MAX_TOKENS)
    .describe('Maximum number of tokens to generate in the completion.'),
  apiBaseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .describe('Optional override for the OpenAI-compatible API base URL.'),
  apiKey: z
    .string()
    .optional()
    .describe('Secret ID containing an OpenAI-compatible API key. A secret must be supplied at runtime.'),
});

type Input = z.infer<typeof inputSchema>;

type OpenAIChatModelConfig = {
  provider: 'openai';
  modelId: string;
  apiKey?: string;
  apiKeySecretId?: string;
  baseUrl?: string;
};

type Output = {
  responseText: string;
  finishReason: string | null;
  rawResponse: unknown;
  usage?: unknown;
  chatModel: OpenAIChatModelConfig;
};

const outputSchema = z.object({
  responseText: z.string(),
  finishReason: z.string().nullable(),
  rawResponse: z.unknown(),
  usage: z.unknown().optional(),
  chatModel: z.object({
    provider: z.literal('openai'),
    modelId: z.string(),
    apiKey: z.string().optional(),
    apiKeySecretId: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.openai.chat',
  label: 'OpenAI Chat Completion',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Executes a one-shot chat completion using the Vercel AI SDK against an OpenAI-compatible endpoint.',
  metadata: {
    slug: 'openai-chat-completion',
    version: '1.0.0',
    type: 'process',
    category: 'building-block',
    description:
      'Send a system + user prompt to an OpenAI compatible chat completion API and return the response.',
    icon: 'MessageCircle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'systemPrompt',
        label: 'System Prompt',
        type: 'string',
        required: false,
        description: 'Optional system message that primes the model.',
      },
      {
        id: 'userPrompt',
        label: 'User Prompt',
        type: 'string',
        required: true,
        description: 'User input that will be sent to the assistant.',
      },
    ],
    outputs: [
      {
        id: 'responseText',
        label: 'Response Text',
        type: 'string',
        description: 'The assistant response from the model.',
      },
      {
        id: 'rawResponse',
        label: 'Raw Response',
        type: 'object',
        description: 'Raw response metadata returned by the provider for debugging.',
      },
      {
        id: 'usage',
        label: 'Token Usage',
        type: 'object',
        description: 'Token usage metadata returned by the provider, if available.',
      },
      {
        id: 'chatModel',
        label: 'Chat Model Config',
        type: 'object',
        description: 'Configuration object (provider, model, overrides) for wiring into downstream nodes such as the AI Agent.',
      },
    ],
    parameters: [
      {
        id: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        default: DEFAULT_MODEL,
        description: 'OpenAI compatible chat model to invoke.',
        options: [
          { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
          { label: 'gpt-4o', value: 'gpt-4o' },
          { label: 'gpt-4.1-mini', value: 'gpt-4.1-mini' },
        ],
      },
      {
        id: 'apiKey',
        label: 'API Key Override',
        type: 'secret',
        required: true,
        default: '',
        placeholder: 'Select stored secret…',
        description: 'Secret containing an OpenAI-compatible API key for this invocation.',
        helpText: 'Store your OpenAI-compatible API key via the secrets adapter and select it here.',
      },
      {
        id: 'temperature',
        label: 'Temperature',
        type: 'number',
        required: false,
        default: DEFAULT_TEMPERATURE,
        min: 0,
        max: 2,
        description: 'Higher values increase creativity, lower values make output deterministic.',
      },
      {
        id: 'maxTokens',
        label: 'Max Tokens',
        type: 'number',
        required: false,
        default: DEFAULT_MAX_TOKENS,
        min: 1,
        max: 4096,
        description: 'Maximum number of tokens to request from the model.',
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
  async execute(
    params, 
    context,
    // Optional dependencies for testing - in production these will use the default implementations
    dependencies?: {
      generateText?: GenerateTextFn;
      createOpenAI?: CreateOpenAIFn;
    }
  ) {
    const { systemPrompt, userPrompt, model, temperature, maxTokens, apiBaseUrl, apiKey } = params;

    const apiKeySecretId = apiKey?.trim() ?? '';
    let resolvedApiKey = '';

    if (apiKeySecretId.length === 0) {
      throw new Error('OpenAI API key secret is required but was not provided.');
    }

    if (!context.secrets) {
      throw new Error(
        'OpenAI Chat component requires the secrets service when an API key secret is provided.',
      );
    }

    context.emitProgress('Resolving OpenAI API key from secret storage...');
    const secret = await context.secrets.get(apiKeySecretId);

    if (!secret || !secret.value) {
      throw new Error(
        `OpenAI API key secret "${apiKeySecretId}" was not found or does not contain a value.`,
      );
    }

    resolvedApiKey = secret.value.trim();

    if (resolvedApiKey.length === 0) {
      throw new Error(`OpenAI API key secret "${apiKeySecretId}" is empty.`);
    }

    const effectiveApiKey = resolvedApiKey;

    const baseURL = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.OPENAI_BASE_URL;
    
    // Use injected dependencies or default implementations
    const createOpenAI = dependencies?.createOpenAI ?? createOpenAIImpl;
    const client = createOpenAI({
      apiKey: effectiveApiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    context.logger.info(`[OpenAIChat] Calling model ${model}`);
    context.emitProgress('Contacting OpenAI-compatible chat completion endpoint...');

    const trimmedSystemPrompt = systemPrompt?.trim();

    try {
      const generateText = dependencies?.generateText ?? generateTextImpl;
      const result = await generateText({
        model: client(model),
        prompt: userPrompt,
        system: trimmedSystemPrompt ? trimmedSystemPrompt : undefined,
        temperature,
        maxOutputTokens: maxTokens,
      });

      context.emitProgress('Received response from OpenAI-compatible provider');

      const chatModelConfig: OpenAIChatModelConfig = {
        provider: 'openai',
        modelId: model,
        ...(apiKeySecretId.length > 0 ? { apiKeySecretId } : {}),
        ...(baseURL ? { baseUrl: baseURL } : {}),
      };

      return {
        responseText: result.text,
        finishReason: result.finishReason ?? null,
        rawResponse: result.response,
        usage: result.usage,
        chatModel: chatModelConfig,
      };
    } catch (error) {
      context.logger.error('[OpenAIChat] Request failed', error);
      throw error;
    }
  },
};

componentRegistry.register(definition);
