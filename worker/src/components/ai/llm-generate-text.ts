import { z } from 'zod';
import { generateText as generateTextImpl } from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  ConfigurationError,
  ComponentRetryPolicy,
} from '@shipsec/component-sdk';
import { llmProviderContractName, LLMProviderSchema } from './chat-model-contract';

const inputSchema = z.object({
  systemPrompt: z
    .string()
    .default('')
    .describe('Optional system instructions that prime the model.'),
  userPrompt: z
    .string()
    .min(1, 'User prompt cannot be empty')
    .describe('Primary user prompt sent to the model.'),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(0.7)
    .describe('Sampling temperature for the response (0-2).'),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(1024)
    .describe('Maximum number of tokens to request from the model.'),
  chatModel: LLMProviderSchema.describe('Provider configuration emitted by a provider component.'),
  modelApiKey: z
    .string()
    .optional()
    .describe('Optional API key override (connect Secret Loader) to supersede the provider config.'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  responseText: string;
  finishReason: string | null;
  rawResponse: unknown;
  usage?: unknown;
};

const outputSchema = z.object({
  responseText: z.string(),
  finishReason: z.string().nullable(),
  rawResponse: z.unknown(),
  usage: z.unknown().optional(),
});

type Dependencies = {
  generateText?: typeof generateTextImpl;
  createOpenAI?: typeof createOpenAIImpl;
  createGoogleGenerativeAI?: typeof createGoogleGenerativeAIImpl;
};

// Retry policy for LLM generation - handle transient API errors
const llmGenerateTextRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'ConfigurationError',
    'ValidationError',
  ],
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.ai.generate-text',
  label: 'AI Generate Text',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: llmGenerateTextRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Runs a single LLM completion using a provider config emitted by the provider components.',
  metadata: {
    slug: 'ai-generate-text',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'One-shot AI text generation that consumes normalized provider configs. Pair with provider components or the AI Agent.',
    icon: 'MessageCircle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'userPrompt',
        label: 'User Prompt',
        dataType: port.text(),
        required: true,
        description: 'User input sent to the model.',
      },
      {
        id: 'chatModel',
        label: 'Provider Config',
        dataType: port.credential(llmProviderContractName),
        required: true,
        description: 'Connect an OpenAI/Gemini/OpenRouter provider component output.',
      },
      {
        id: 'modelApiKey',
        label: 'API Key Override',
        dataType: port.secret(),
        required: false,
        description: 'Optional override API key to supersede the provider config.',
      },
    ],
    outputs: [
      {
        id: 'responseText',
        label: 'Response Text',
        dataType: port.text(),
        description: 'Assistant response returned by the provider.',
      },
      {
        id: 'rawResponse',
        label: 'Raw Response',
        dataType: port.json(),
        description: 'Raw response metadata returned by the provider for debugging.',
      },
      {
        id: 'usage',
        label: 'Token Usage',
        dataType: port.json(),
        description: 'Token usage metadata returned by the provider, if available.',
      },
    ],
    parameters: [
      {
        id: 'systemPrompt',
        label: 'System Prompt',
        type: 'textarea',
        required: false,
        default: '',
        rows: 3,
        description: 'Optional system instructions that guide the model response.',
      },
      {
        id: 'temperature',
        label: 'Temperature',
        type: 'number',
        required: false,
        default: 0.7,
        min: 0,
        max: 2,
        description: 'Higher values increase creativity, lower values improve determinism.',
      },
      {
        id: 'maxTokens',
        label: 'Max Tokens',
        type: 'number',
        required: false,
        default: 1024,
        min: 1,
        max: 1_000_000,
        description: 'Maximum number of tokens to request from the provider.',
      },
    ],
  },
  async execute(params, context, dependencies?: Dependencies) {
    const { systemPrompt, userPrompt, temperature, maxTokens, chatModel, modelApiKey } = params;

    const generateText = dependencies?.generateText ?? generateTextImpl;
    const createOpenAI = dependencies?.createOpenAI ?? createOpenAIImpl;
    const createGoogleGenerativeAI =
      dependencies?.createGoogleGenerativeAI ?? createGoogleGenerativeAIImpl;

    const resolvedApiKey = modelApiKey?.trim() || chatModel.apiKey?.trim();
    if (!resolvedApiKey) {
      throw new ConfigurationError(
        'No API key available. Provide a key via the provider component or connect an override.',
        { configKey: 'apiKey' }
      );
    }

    const trimmedSystemPrompt = systemPrompt?.trim();
    const model = buildModelFactory(chatModel, resolvedApiKey, {
      createOpenAI,
      createGoogleGenerativeAI,
    });

    context.logger.info(`[AIGenerateText] Calling ${chatModel.provider} model ${chatModel.modelId}`);

    const result = await generateText({
      model,
      prompt: userPrompt,
      system: trimmedSystemPrompt ? trimmedSystemPrompt : undefined,
      temperature,
      maxOutputTokens: maxTokens,
    });

    return {
      responseText: result.text,
      finishReason: result.finishReason ?? null,
      rawResponse: result.response,
      usage: result.usage,
    };
  },
};

function buildModelFactory(
  config: z.infer<typeof LLMProviderSchema>,
  apiKey: string,
  factories: {
    createOpenAI: typeof createOpenAIImpl;
    createGoogleGenerativeAI: typeof createGoogleGenerativeAIImpl;
  },
) {
  if (config.provider === 'gemini') {
    const client = factories.createGoogleGenerativeAI({
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.projectId ? { projectId: config.projectId } : {}),
    });
    return client(config.modelId);
  }

  const client = factories.createOpenAI({
    apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
  });

  return client(config.modelId);
}

componentRegistry.register(definition);
