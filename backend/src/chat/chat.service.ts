import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import { tool, ToolLoopAgent, pipeAgentUIStreamToResponse, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';

import { StudioMcpService } from '../studio-mcp/studio-mcp.service';
import { ChatSessionRepository } from './chat-session.repository';
import type { AuthContext } from '../auth/types';

const SYSTEM_PROMPT = `You are ShipSec AI, an intelligent assistant embedded in ShipSec Studio.
You help users manage their automation workflows. You can:
- List, inspect, and run workflows
- Check run status and results
- Browse available components

Be concise and helpful. When a user asks to run a workflow, confirm the workflow name
and any required inputs before executing. Always show run IDs so users can track progress.`;

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly studioMcpService: StudioMcpService,
    private readonly sessionRepository: ChatSessionRepository,
  ) {}

  onModuleInit() {
    const baseURL = process.env.CHAT_AI_BASE_URL;
    const apiKey = process.env.CHAT_AI_API_KEY;
    const modelId = process.env.CHAT_AI_MODEL_ID;
    const providerName = process.env.CHAT_AI_PROVIDER ?? 'chat-provider';

    const missing: string[] = [];
    if (!baseURL) missing.push('CHAT_AI_BASE_URL');
    if (!apiKey) missing.push('CHAT_AI_API_KEY');
    if (!modelId) missing.push('CHAT_AI_MODEL_ID');

    if (missing.length === 3) {
      this.logger.warn(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID to enable the chat agent.',
      );
    } else if (missing.length > 0) {
      this.logger.warn(
        `Chat AI partially configured. Missing: ${missing.join(', ')}. Chat agent will not work until all variables are set.`,
      );
    } else {
      this.logger.log(`Chat AI configured with provider: ${providerName}, model: ${modelId}`);
    }
  }

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

  // --- Session CRUD ---

  async createSession(auth: AuthContext, title?: string) {
    const session = await this.sessionRepository.createSession(
      auth.userId ?? 'anonymous',
      auth.organizationId,
      title,
    );
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async listSessions(auth: AuthContext) {
    const sessions = await this.sessionRepository.listSessions({
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async getSession(id: string, auth: AuthContext) {
    const session = await this.sessionRepository.getSession(id, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async updateSessionTitle(id: string, title: string, auth: AuthContext) {
    const session = await this.sessionRepository.updateSessionTitle(id, title, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async deleteSession(id: string, auth: AuthContext) {
    await this.sessionRepository.deleteSession(id, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
  }

  async getMessages(sessionId: string, auth: AuthContext) {
    // Verify ownership
    await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });

    const messages = await this.sessionRepository.getMessages(sessionId);
    return messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    }));
  }

  // --- Streaming chat ---

  async streamChatToResponse(
    sessionId: string,
    messages: UIMessage[],
    auth: AuthContext,
    res: ServerResponse,
  ): Promise<void> {
    // Verify session ownership
    await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });

    const maxSteps = parseInt(process.env.CHAT_AI_MAX_STEPS ?? '60', 10);
    const timeoutMs = parseInt(process.env.CHAT_AI_TIMEOUT_MS ?? '120000', 10);

    // Save the latest user message to DB
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      await this.sessionRepository.saveMessage(sessionId, {
        role: lastMessage.role,
        parts: lastMessage.parts,
      });
    }

    const toolDefs = this.studioMcpService.getToolDefinitions(auth);

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
      stopWhen: stepCountIs(maxSteps),
    });

    await pipeAgentUIStreamToResponse({
      agent,
      uiMessages: messages,
      response: res,
      abortSignal: AbortSignal.timeout(timeoutMs),
      onFinish: async (result) => {
        try {
          // Save assistant messages to DB
          if (result.messages) {
            for (const msg of result.messages) {
              if (msg.role === 'assistant' && 'parts' in msg && Array.isArray(msg.parts)) {
                await this.sessionRepository.saveMessage(sessionId, {
                  role: msg.role,
                  parts: msg.parts,
                });
              }
            }
          }
          // Touch session to update its updatedAt
          await this.sessionRepository.touchSession(sessionId);
        } catch (error) {
          this.logger.error('Failed to save assistant message', error);
        }
      },
    });
  }
}
