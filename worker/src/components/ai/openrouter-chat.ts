import { z } from 'zod';
import { generateText as generateTextImpl } from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import {
  componentRegistry,
  ComponentDefinition,
  port,
} from '@shipsec/component-sdk';

export type GenerateTextFn = typeof generateTextImpl;
export type CreateOpenAIFn = typeof createOpenAIImpl;

const DEFAULT_MODEL = 'openrouter/auto';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const DEFAULT_HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER ?? '';
const DEFAULT_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'ShipSec Studio';

const inputSchema = z.object({
  systemPrompt: z
    .string()
    .default('')
    .describe('Optional system instructions that prime the OpenRouter-hosted model.'),
  userPrompt: z
    .string()
    .min(1, 'User prompt cannot be empty')
    .describe('Primary user prompt sent to the model via OpenRouter.'),
  model: z
    .string()
    .default(DEFAULT_MODEL)
    .describe('OpenRouter model identifier (e.g., openrouter/auto, anthropic/claude-3.5-sonnet).'),
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
    .max(8192)
    .default(DEFAULT_MAX_TOKENS)
    .describe('Maximum number of tokens to request from the OpenRouter model.'),
  apiBaseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .describe('Optional override for the OpenRouter API base URL.'),
  apiKey: z
    .string()
    .optional()
    .describe('Secret ID containing an OpenRouter API key. A secret must be supplied at runtime.'),
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

type OpenRouterChatModelConfig = {
  provider: 'openrouter';
  modelId: string;
  apiKey?: string;
  apiKeySecretId?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};

type Output = {
  responseText: string;
  finishReason: string | null;
  rawResponse: unknown;
  usage?: unknown;
  chatModel: OpenRouterChatModelConfig;
};

const outputSchema = z.object({
  responseText: z.string(),
  finishReason: z.string().nullable(),
  rawResponse: z.unknown(),
  usage: z.unknown().optional(),
  chatModel: z.object({
    provider: z.literal('openrouter'),
    modelId: z.string(),
    apiKey: z.string().optional(),
    apiKeySecretId: z.string().optional(),
    baseUrl: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.openrouter.chat',
  label: 'OpenRouter Chat Completion',
  category: 'ai',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Executes a one-shot chat completion using the Vercel AI SDK against an OpenRouter endpoint.',
  metadata: {
    slug: 'openrouter-chat-completion',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'Send a system + user prompt to an OpenRouter chat completion API and return the response.',
    icon: 'MessageCircle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'systemPrompt',
        label: 'System Prompt',
        dataType: port.text(),
        required: false,
        description: 'Optional system instructions that guide the model response.',
      },
      {
        id: 'userPrompt',
        label: 'User Prompt',
        dataType: port.text(),
        required: true,
        description: 'User input that will be sent to OpenRouter.',
      },
    ],
    outputs: [
      {
        id: 'responseText',
        label: 'Response Text',
        dataType: port.text(),
        description: 'The assistant response returned by OpenRouter.',
      },
      {
        id: 'rawResponse',
        label: 'Raw Response',
        dataType: port.json(),
        description: 'Raw response metadata returned by OpenRouter for debugging.',
      },
      {
        id: 'usage',
        label: 'Token Usage',
        dataType: port.json(),
        description: 'Token usage metadata returned by the provider, if available.',
      },
      {
        id: 'chatModel',
        label: 'Chat Model Config',
        dataType: port.json(),
        description: 'Configuration object for wiring into downstream nodes such as the AI Agent.',
      },
    ],
    parameters: [
      {
        id: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        default: DEFAULT_MODEL,
        description: 'OpenRouter model to invoke.',
        options: [
          { label: 'Auto Route', value: 'openrouter/auto' },
          { label: 'GPT-5 Pro', value: 'openai/gpt-5-pro' },
          { label: 'GPT-5 Mini', value: 'openai/gpt-5-mini' },
          { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4.5' },
          { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4.5' },
          { label: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro' },
          { label: 'Gemini 2.5 Flash Lite', value: 'google/gemini-2.5-flash-lite' },
          { label: 'Llama 4 Maverick', value: 'meta-llama/llama-4-maverick' },
        ],
      },
      {
        id: 'apiKey',
        label: 'API Key Override',
        type: 'secret',
        required: true,
        default: '',
        placeholder: 'Select stored secret…',
        description: 'Secret containing an OpenRouter API key for this invocation.',
        helpText: 'Store your OpenRouter API key via the secrets adapter and select it here.',
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
        max: 8192,
        description: 'Maximum number of tokens to request from the model.',
      },
      {
        id: 'apiBaseUrl',
        label: 'API Base URL',
        type: 'text',
        required: false,
        default: DEFAULT_BASE_URL,
        description: 'Override for the OpenRouter API base URL (leave blank for the default endpoint).',
      },
      {
        id: 'httpReferer',
        label: 'HTTP Referer',
        type: 'text',
        required: false,
        default: DEFAULT_HTTP_REFERER,
        description: 'Value sent via the HTTP-Referer header so OpenRouter can validate your origin.',
      },
      {
        id: 'appTitle',
        label: 'Application Title',
        type: 'text',
        required: false,
        default: DEFAULT_APP_TITLE,
        description: 'Value sent via the X-Title header to describe your application.',
      },
    ],
  },
  async execute(
    params,
    context,
    dependencies?: {
      generateText?: GenerateTextFn;
      createOpenAI?: CreateOpenAIFn;
    },
  ) {
    const {
      systemPrompt,
      userPrompt,
      model,
      temperature,
      maxTokens,
      apiBaseUrl,
      apiKey,
      httpReferer,
      appTitle,
    } = params;

    const apiKeySecretId = apiKey?.trim() ?? '';
    if (apiKeySecretId.length === 0) {
      throw new Error('OpenRouter API key secret is required but was not provided.');
    }

    if (!context.secrets) {
      throw new Error(
        'OpenRouter Chat component requires the secrets service when an API key secret is provided.',
      );
    }

    context.emitProgress('Resolving OpenRouter API key from secret storage...');
    const secret = await context.secrets.get(apiKeySecretId);

    if (!secret || !secret.value) {
      throw new Error(
        `OpenRouter API key secret "${apiKeySecretId}" was not found or does not contain a value.`,
      );
    }

    const resolvedApiKey = secret.value.trim();
    if (resolvedApiKey.length === 0) {
      throw new Error(`OpenRouter API key secret "${apiKeySecretId}" is empty.`);
    }

    const baseURL = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;

    const sanitizedHeaders: Record<string, string> = {};
    const refererHeader = httpReferer?.trim() ?? '';
    const appTitleHeader = appTitle?.trim() ?? '';
    if (refererHeader.length > 0) {
      sanitizedHeaders['HTTP-Referer'] = refererHeader;
    }
    if (appTitleHeader.length > 0) {
      sanitizedHeaders['X-Title'] = appTitleHeader;
    }

    const createOpenAI = dependencies?.createOpenAI ?? createOpenAIImpl;
    const client = createOpenAI({
      apiKey: resolvedApiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(Object.keys(sanitizedHeaders).length > 0 ? { headers: sanitizedHeaders } : {}),
    });

    context.logger.info(`[OpenRouterChat] Calling model ${model}`);
    context.emitProgress('Contacting OpenRouter chat completion endpoint...');

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

      context.emitProgress('Received response from OpenRouter provider');

      const chatModelConfig: OpenRouterChatModelConfig = {
        provider: 'openrouter',
        modelId: model,
        ...(apiKeySecretId.length > 0 ? { apiKeySecretId } : {}),
        ...(baseURL ? { baseUrl: baseURL } : {}),
        ...(Object.keys(sanitizedHeaders).length > 0 ? { headers: sanitizedHeaders } : {}),
      };

      return {
        responseText: result.text,
        finishReason: result.finishReason ?? null,
        rawResponse: result.response,
        usage: result.usage,
        chatModel: chatModelConfig,
      };
    } catch (error) {
      context.logger.error('[OpenRouterChat] Request failed', error);
      throw error;
    }
  },
};

componentRegistry.register(definition);
