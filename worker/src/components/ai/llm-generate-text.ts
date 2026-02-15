import { z } from 'zod';
import { randomUUID } from 'crypto';
import { generateText as generateTextImpl } from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
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
import {
  shouldRouteViaLiteLLM,
  getLiteLLMBaseUrl,
  getLiteLLMApiKey,
  normalizeLiteLLMModel,
  combineHeaders,
} from './utils';

const inputSchema = inputs({
  userPrompt: port(
    z
      .string()
      .min(1, 'User prompt cannot be empty')
      .describe('Primary user prompt sent to the model.'),
    {
      label: 'User Prompt',
      description: 'User input sent to the model.',
    },
  ),
  chatModel: port(LLMProviderSchema(), {
    label: 'Provider Config',
    description: 'Connect an OpenAI/Gemini/OpenRouter provider component output.',
  }),
  modelApiKey: port(
    z
      .string()
      .optional()
      .describe(
        'Optional API key override (connect Secret Loader) to supersede the provider config.',
      ),
    {
      label: 'API Key Override',
      description: 'Optional override API key to supersede the provider config.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  systemPrompt: param(
    z.string().default('').describe('Optional system instructions that prime the model.'),
    {
      label: 'System Prompt',
      editor: 'textarea',
      rows: 3,
      description: 'Optional system instructions that guide the model response.',
    },
  ),
  temperature: param(
    z.number().min(0).max(2).default(0.7).describe('Sampling temperature for the response (0-2).'),
    {
      label: 'Temperature',
      editor: 'number',
      min: 0,
      max: 2,
      description: 'Higher values increase creativity, lower values improve determinism.',
    },
  ),
  maxTokens: param(
    z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1024)
      .describe('Maximum number of tokens to request from the model.'),
    {
      label: 'Max Tokens',
      editor: 'number',
      min: 1,
      max: 1_000_000,
      description: 'Maximum number of tokens to request from the provider.',
    },
  ),
});

const outputSchema = outputs({
  responseText: port(z.string(), {
    label: 'Response Text',
    description: 'Assistant response returned by the provider.',
  }),
  finishReason: port(z.string().nullable(), {
    label: 'Finish Reason',
    description: 'Provider finish reason, if supplied.',
  }),
  rawResponse: port(z.unknown(), {
    label: 'Raw Response',
    description: 'Raw response metadata returned by the provider for debugging.',
    allowAny: true,
    reason: 'Provider response payloads vary by model and API.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  usage: port(z.unknown().optional(), {
    label: 'Token Usage',
    description: 'Token usage metadata returned by the provider, if available.',
    allowAny: true,
    reason: 'Provider usage payloads vary by model and API.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

interface Dependencies {
  generateText?: typeof generateTextImpl;
  createOpenAI?: typeof createOpenAIImpl;
  createGoogleGenerativeAI?: typeof createGoogleGenerativeAIImpl;
}

// Retry policy for LLM generation - handle transient API errors
const llmGenerateTextRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['AuthenticationError', 'ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.ai.generate-text',
  label: 'AI Generate Text',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: llmGenerateTextRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs a single LLM completion using a provider config emitted by the provider components.',
  ui: {
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
  },
  async execute({ inputs, params }, context, dependencies?: Dependencies) {
    const { systemPrompt, temperature, maxTokens } = params;
    const { userPrompt, chatModel, modelApiKey } = inputs;
    const requestKey = randomUUID();
    const liteLLMEnabled = shouldRouteViaLiteLLM();
    const liteLLMBaseUrl = getLiteLLMBaseUrl();
    const liteLLMApiKey = getLiteLLMApiKey();
    const routedModel = liteLLMEnabled
      ? normalizeLiteLLMModel(chatModel.provider, chatModel.modelId)
      : chatModel.modelId;

    const generateText = dependencies?.generateText ?? generateTextImpl;
    const createOpenAI = dependencies?.createOpenAI ?? createOpenAIImpl;
    const createGoogleGenerativeAI =
      dependencies?.createGoogleGenerativeAI ?? createGoogleGenerativeAIImpl;

    const resolvedApiKey = liteLLMEnabled
      ? liteLLMApiKey || modelApiKey?.trim() || chatModel.apiKey?.trim()
      : modelApiKey?.trim() || chatModel.apiKey?.trim();
    if (!resolvedApiKey) {
      throw new ConfigurationError(
        'No API key available. Provide a key via the provider component or connect an override.',
        { configKey: 'apiKey' },
      );
    }

    const organizationId =
      typeof context.metadata.organizationId === 'string' ? context.metadata.organizationId : null;
    const modelHeaders = 'headers' in chatModel ? chatModel.headers : undefined;
    const requestHeaders = combineHeaders(modelHeaders, {
      'x-shipsec-org-id': String(organizationId ?? ''),
      'x-shipsec-run-id': String(context.runId ?? ''),
      'x-shipsec-node-ref': String(context.componentRef ?? ''),
      'x-shipsec-request-id': requestKey,
      'x-shipsec-channel': 'workflow_agent',
      'x-shipsec-provider': chatModel.provider,
      'x-shipsec-model': routedModel,
    });

    const trimmedSystemPrompt = systemPrompt?.trim();
    const model = buildModelFactory(
      {
        config: chatModel,
        apiKey: resolvedApiKey,
        routeViaLiteLLM: liteLLMEnabled,
        routedModel,
        baseUrl: liteLLMEnabled ? liteLLMBaseUrl : chatModel.baseUrl,
        headers: requestHeaders,
      },
      {
        createOpenAI,
        createGoogleGenerativeAI,
      },
    );

    context.logger.info(`[AIGenerateText] Calling ${chatModel.provider} model ${routedModel}`);

    const result = await generateText({
      model,
      prompt: userPrompt,
      system: trimmedSystemPrompt ? trimmedSystemPrompt : undefined,
      temperature,
      maxOutputTokens: maxTokens,
    });

    if (result.usage && context.agentTracePublisher) {
      await context.agentTracePublisher.publish({
        agentRunId: `${context.runId}:${context.componentRef}:${requestKey}`,
        workflowRunId: context.runId,
        nodeRef: context.componentRef,
        sequence: 1,
        timestamp: new Date().toISOString(),
        part: {
          type: 'data-usage',
          data: {
            usage: result.usage,
            requestId: requestKey,
            channel: 'workflow_agent',
            provider: chatModel.provider,
            model: routedModel,
          },
        },
      });
    }

    return {
      responseText: result.text,
      finishReason: result.finishReason ?? null,
      rawResponse: result.response,
      usage: result.usage,
    };
  },
});

function buildModelFactory(
  params: {
    config: LlmProviderConfig;
    apiKey: string;
    routeViaLiteLLM: boolean;
    routedModel: string;
    baseUrl?: string;
    headers?: Record<string, string>;
  },
  factories: {
    createOpenAI: typeof createOpenAIImpl;
    createGoogleGenerativeAI: typeof createGoogleGenerativeAIImpl;
  },
) {
  const { config, apiKey, routeViaLiteLLM, routedModel, baseUrl, headers } = params;

  if (!routeViaLiteLLM && config.provider === 'gemini') {
    const client = factories.createGoogleGenerativeAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(config.projectId ? { projectId: config.projectId } : {}),
    });
    return client(routedModel);
  }

  const client = factories.createOpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
    ...(headers ? { headers } : {}),
  });

  return client(routedModel);
}

componentRegistry.register(definition);
