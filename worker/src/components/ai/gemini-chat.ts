import { z } from 'zod';
import { generateText as generateTextImpl } from 'ai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

// Define types for dependencies to enable dependency injection for testing
export type GenerateTextFn = typeof generateTextImpl;
export type CreateGoogleGenerativeAIFn = typeof createGoogleGenerativeAIImpl;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_BASE_URL = process.env.GEMINI_BASE_URL ?? '';

const inputSchema = z.object({
  systemPrompt: z
    .string()
    .default('')
    .describe('Optional system instructions sent to the Gemini model.'),
  userPrompt: z
    .string()
    .min(1, 'User prompt cannot be empty')
    .describe('Primary user prompt sent to Gemini.'),
  model: z
    .string()
    .default(DEFAULT_MODEL)
    .describe('Gemini chat model identifier.'),
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
    .describe('Maximum number of tokens to generate from Gemini.'),
  apiBaseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .describe('Optional override for the Gemini API base URL.'),
  apiKey: z
    .string()
    .optional()
    .describe('Secret ID containing a Gemini API key. A secret must be supplied at runtime.'),
});

type Input = z.infer<typeof inputSchema>;

type GeminiChatModelConfig = {
  provider: 'gemini';
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
  chatModel: GeminiChatModelConfig;
};

const chatModelOutputSchema = z.object({
  provider: z.literal('gemini'),
  modelId: z.string(),
  apiKey: z.string().optional(),
  apiKeySecretId: z.string().optional(),
  baseUrl: z.string().optional(),
});

const outputSchema = z.object({
  responseText: z.string(),
  finishReason: z.string().nullable(),
  rawResponse: z.unknown(),
  usage: z.unknown().optional(),
  chatModel: chatModelOutputSchema,
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.gemini.chat',
  label: 'Gemini Chat Completion',
  category: 'transform',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Executes a one-shot chat completion using the Vercel AI SDK against a Gemini endpoint.',
  metadata: {
    slug: 'gemini-chat-completion',
    version: '1.0.0',
    type: 'process',
    category: 'building-block',
    description: 'Send a system + user prompt to a Gemini chat completion API and return the response.',
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
        description: 'Optional system instructions that prime the Gemini model.',
      },
      {
        id: 'userPrompt',
        label: 'User Prompt',
        type: 'string',
        required: true,
        description: 'User input that will be sent to Gemini.',
      },
    ],
    outputs: [
      {
        id: 'responseText',
        label: 'Response Text',
        type: 'string',
        description: 'The assistant response from Gemini.',
      },
      {
        id: 'rawResponse',
        label: 'Raw Response',
        type: 'object',
        description: 'Raw response metadata returned by the Gemini provider for debugging.',
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
        description: 'Configuration object (provider, model, overrides) for wiring into the LangChain Agent node.',
      },
    ],
    parameters: [
      {
        id: 'model',
        label: 'Model',
        type: 'select',
        required: true,
        default: DEFAULT_MODEL,
        description: 'Gemini chat model to invoke.',
        options: [
          { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
          { label: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash-latest' },
          { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro-latest' },
          { label: 'Gemini 1.5 Flash 8B', value: 'gemini-1.5-flash-8b-latest' },
        ],
      },
      {
        id: 'apiKey',
        label: 'API Key Override',
        type: 'secret',
        required: true,
        default: '',
        placeholder: 'Select stored secret…',
        description: 'Secret containing a Gemini API key for this invocation.',
        helpText: 'Store your Gemini API key via the secrets adapter and select it here.',
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
        description: 'Override for the Gemini API base URL (leave blank for the default provider URL).',
      },
    ],
  },
  async execute(
    params, 
    context,
    // Optional dependencies for testing - in production these will use the default implementations
    dependencies?: {
      generateText?: GenerateTextFn;
      createGoogleGenerativeAI?: CreateGoogleGenerativeAIFn;
    }
  ) {
    const { systemPrompt, userPrompt, model, temperature, maxTokens, apiBaseUrl, apiKey } = params;

    const apiKeySecretId = apiKey?.trim() ?? '';

    if (apiKeySecretId.length === 0) {
      throw new Error('Gemini API key secret is required but was not provided.');
    }

    if (!context.secrets) {
      throw new Error(
        'Gemini Chat component requires the secrets service when an API key secret is provided.',
      );
    }

    context.emitProgress('Resolving Gemini API key from secret storage...');
    const secret = await context.secrets.get(apiKeySecretId);

    if (!secret || !secret.value) {
      throw new Error(
        `Gemini API key secret "${apiKeySecretId}" was not found or does not contain a value.`,
      );
    }

    const resolvedApiKey = secret.value.trim();

    if (resolvedApiKey.length === 0) {
      throw new Error(`Gemini API key secret "${apiKeySecretId}" is empty.`);
    }

    const baseUrl = apiBaseUrl?.trim() ? apiBaseUrl.trim() : process.env.GEMINI_BASE_URL;
    const resolvedModel = model.trim();
    const modelIdentifier = resolvedModel.startsWith('models/')
      ? resolvedModel
      : `models/${resolvedModel}`;
    
    // Use injected dependencies or default implementations
    const createGoogleGenerativeAI = dependencies?.createGoogleGenerativeAI ?? createGoogleGenerativeAIImpl;
    const client = createGoogleGenerativeAI({
      apiKey: resolvedApiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    context.logger.info(`[GeminiChat] Calling model ${model}`);
    context.emitProgress('Contacting Gemini chat completion endpoint...');

    const trimmedSystemPrompt = systemPrompt?.trim();

    try {
      const generateText = dependencies?.generateText ?? generateTextImpl;
      const response = await generateText({
        model: client(modelIdentifier),
        prompt: userPrompt,
        system: trimmedSystemPrompt ? trimmedSystemPrompt : undefined,
        temperature,
        maxOutputTokens: maxTokens,
      });
      const responseText = response.text ?? '';
      const finishReason = response.finishReason ?? null;

      context.emitProgress('Received response from Gemini provider');

      const chatModelConfig: GeminiChatModelConfig = {
        provider: 'gemini',
        modelId: model,
        ...(apiKeySecretId.length > 0 ? { apiKeySecretId } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      };

      return {
        responseText,
        finishReason,
        rawResponse: response.response,
        usage: response.usage,
        chatModel: chatModelConfig,
      };
    } catch (error) {
      context.logger.error('[GeminiChat] Request failed', error);
      throw error;
    }
  },
};

componentRegistry.register(definition);
