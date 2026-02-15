import { Injectable } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import { tool, ToolLoopAgent, pipeAgentUIStreamToResponse, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';

import { StudioMcpService } from '../studio-mcp/studio-mcp.service';
import type { AuthContext } from '../auth/types';

const SYSTEM_PROMPT = `You are ShipSec AI, an intelligent assistant embedded in ShipSec Studio.
You help users manage their automation workflows. You can:
- List, inspect, and run workflows
- Check run status and results
- Browse available components

Be concise and helpful. When a user asks to run a workflow, confirm the workflow name
and any required inputs before executing. Always show run IDs so users can track progress.`;

/**
 * Resolves the LLM provider configuration from environment variables.
 *
 * Uses `createOpenAI` from @ai-sdk/openai which is compatible with any
 * OpenAI-compatible API (OpenAI, OpenRouter, z.ai, Ollama, vLLM, etc.).
 *
 * Environment variables:
 *   CHAT_AI_API_KEY     — API key for the provider (required)
 *   CHAT_AI_BASE_URL    — Base URL of the provider's API (required)
 *   CHAT_AI_MODEL_ID    — Model identifier (required)
 *   CHAT_AI_PROVIDER    — Friendly name for logging (default: 'chat-provider')
 *
 * Examples:
 *   # OpenRouter
 *   CHAT_AI_BASE_URL=https://openrouter.ai/api/v1
 *   CHAT_AI_API_KEY=sk-or-...
 *   CHAT_AI_MODEL_ID=anthropic/claude-sonnet-4
 *
 *   # z.ai (used in e2e tests)
 *   CHAT_AI_BASE_URL=https://api.z.ai/api/coding/paas/v4
 *   CHAT_AI_API_KEY=...
 *   CHAT_AI_MODEL_ID=glm-4.7
 *
 *   # OpenAI direct
 *   CHAT_AI_BASE_URL=https://api.openai.com/v1
 *   CHAT_AI_API_KEY=sk-...
 *   CHAT_AI_MODEL_ID=gpt-4o
 *
 *   # Local Ollama
 *   CHAT_AI_BASE_URL=http://localhost:11434/v1
 *   CHAT_AI_MODEL_ID=llama3
 */

@Injectable()
export class ChatService {
  constructor(private readonly studioMcpService: StudioMcpService) {}

  private getModel() {
    const baseURL = process.env.CHAT_AI_BASE_URL;
    const apiKey = process.env.CHAT_AI_API_KEY;
    const modelId = process.env.CHAT_AI_MODEL_ID;
    const providerName = process.env.CHAT_AI_PROVIDER ?? 'chat-provider';

    if (!baseURL || !apiKey || !modelId) {
      throw new Error(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID environment variables.',
      );
    }

    const provider = createOpenAI({
      baseURL,
      apiKey,
      name: providerName,
    });

    return provider.chat(modelId);
  }

  async streamChatToResponse(
    messages: UIMessage[],
    auth: AuthContext,
    res: ServerResponse,
  ): Promise<void> {
    const toolDefs = this.studioMcpService.getToolDefinitions(auth);

    // Tools are built dynamically from shared definitions — use `any` for the
    // record value because the AI SDK generic can't infer types from a dynamic shape.

    const tools: Record<string, any> = {};
    for (const def of toolDefs) {
      tools[def.name] = tool({
        description: def.description,
        inputSchema: z.object(def.inputSchema),
        execute: async (args: Record<string, unknown>) => {
          try {
            return await def.execute(args);
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        },
      });
    }

    const agent = new ToolLoopAgent({
      model: this.getModel(),
      instructions: SYSTEM_PROMPT,
      tools,
      stopWhen: stepCountIs(5),
    });

    await pipeAgentUIStreamToResponse({
      agent,
      uiMessages: messages,
      response: res,
    });
  }
}
