import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { streamText, generateObject, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export type ModelProvider = 'openai' | 'gemini';

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  mode: 'streaming' | 'object' | 'text';
  schema?: z.ZodTypeAny;
  model?: string;
  provider?: ModelProvider;
  temperature?: number;
  context?: AIGenerationContext;
}

export interface AIGenerationContext {
  type: 'template' | 'agent' | 'report' | 'general';
  data?: Record<string, unknown>;
}

export interface GenerationResult {
  text?: string;
  object?: unknown;
  usage?: { totalTokens: number; promptTokens: number; completionTokens: number };
  stream?: Awaited<ReturnType<typeof streamText>>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: ReturnType<typeof createOpenAI>;
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;
  private readonly defaultProvider: ModelProvider;
  private readonly hasOpenAiKey: boolean;
  private readonly hasGoogleKey: boolean;

  constructor() {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const googleApiKey = process.env.GOOGLE_API_KEY;

    this.openai = createOpenAI({ apiKey: openaiApiKey });
    this.google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    this.hasOpenAiKey = Boolean(openaiApiKey);
    this.hasGoogleKey = Boolean(googleApiKey);
    this.defaultProvider = this.resolveDefaultProvider();
  }

  private getModel(provider: ModelProvider, model?: string) {
    const modelName = model || (provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini');
    this.ensureProviderConfigured(provider);
    return provider === 'gemini' ? this.google(modelName) : this.openai(modelName);
  }

  private resolveDefaultProvider(): ModelProvider {
    const envProvider = process.env.SHIPSEC_AI_PROVIDER ?? process.env.AI_PROVIDER;
    if (envProvider === 'gemini' || envProvider === 'openai') {
      return envProvider;
    }
    if (this.hasGoogleKey) {
      return 'gemini';
    }
    return 'openai';
  }

  private ensureProviderConfigured(provider: ModelProvider) {
    if (provider === 'gemini' && !this.hasGoogleKey) {
      throw new Error('GOOGLE_API_KEY is required for Gemini models');
    }
    if (provider === 'openai' && !this.hasOpenAiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI models');
    }
  }

  buildSystemPrompt(context?: AIGenerationContext): string {
    if (!context) return 'You are a helpful AI assistant.';

    const prompts: Record<string, string> = {
      template: 'You are a report template generation expert. Generate HTML templates.',
      agent: 'You are an AI agent assistant.',
      report: 'You are a security report analyst.',
      general: 'You are a helpful AI assistant.',
    };

    return prompts[context.type] || prompts.general;
  }

  async generate(options: GenerateOptions): Promise<GenerationResult> {
    const {
      prompt,
      systemPrompt,
      mode,
      schema,
      model,
      provider,
      temperature = 0.7,
      context,
    } = options;
    const selectedProvider = provider ?? this.defaultProvider;

    const messages = [
      { role: 'system' as const, content: systemPrompt || this.buildSystemPrompt(context) },
      { role: 'user' as const, content: prompt },
    ];

    try {
      if (mode === 'streaming') {
        return {
          stream: streamText({ model: this.getModel(selectedProvider, model), messages, temperature }),
        };
      }

      if (mode === 'object' && schema) {
        const result = await generateObject({
          model: this.getModel(selectedProvider, model),
          schema,
          messages,
          temperature,
        });
        return { object: result.object, usage: result.usage as any };
      }

      const result = await generateText({
        model: this.getModel(selectedProvider, model),
        messages,
        temperature,
      });
      return { text: result.text, usage: result.usage as any };
    } catch (error) {
      this.logger.error(`AI generation failed: ${error}`);
      throw error;
    }
  }

  async generateTemplate(prompt: string, options?: { systemPrompt?: string; model?: string; temperature?: number }) {
    const result = await this.generate({
      prompt,
      systemPrompt: options?.systemPrompt,
      mode: 'object',
      schema: z.object({
        template: z.string().describe('The HTML template string'),
        description: z.string().describe('Brief description'),
        inputSchema: z.record(z.string(), z.unknown()).describe('JSON Schema'),
      }),
      model: options?.model,
      temperature: options?.temperature,
      context: { type: 'template' },
    });
    return result.object as { template: string; description: string; inputSchema: Record<string, unknown> };
  }
}
