import { z } from 'zod';
import { registerContract } from '@shipsec/component-sdk';

export const llmProviderContractName = 'core.ai.llm-provider.v1';

const openAIProviderSchema = z.object({
  provider: z.literal('openai'),
  modelId: z.string(),
  apiKey: z.string().optional(),
  apiKeySecretId: z.string().optional(),
  baseUrl: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const geminiProviderSchema = z.object({
  provider: z.literal('gemini'),
  modelId: z.string(),
  apiKey: z.string().optional(),
  apiKeySecretId: z.string().optional(),
  baseUrl: z.string().optional(),
  projectId: z.string().optional(),
});

const openRouterProviderSchema = z.object({
  provider: z.literal('openrouter'),
  modelId: z.string(),
  apiKey: z.string().optional(),
  apiKeySecretId: z.string().optional(),
  baseUrl: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const LLMProviderSchema = z.discriminatedUnion('provider', [
  openAIProviderSchema,
  geminiProviderSchema,
  openRouterProviderSchema,
]);

registerContract({
  name: llmProviderContractName,
  schema: LLMProviderSchema,
  summary: 'Normalized provider config (OpenAI, Gemini, OpenRouter) for AI components.',
  description:
    'Portable large language model configuration (provider, model, transport settings) that consumers use to instantiate providers at runtime.',
});
