import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import type { UIMessage } from 'ai';
import type { ServerResponse } from 'node:http';

import { StudioMcpService } from '../studio-mcp/studio-mcp.service';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatStreamService } from './chat-stream.service';
import { TemporalService } from '../temporal/temporal.service';
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
    private readonly chatStreamService: ChatStreamService,
    private readonly temporalService: TemporalService,
  ) {}

  onModuleInit() {
    this.logger.log('Chat agent mode: Temporal (durable workflows)');
  }

  // --- Session CRUD ---

  async createSession(auth: AuthContext, title?: string) {
    const session = await this.sessionRepository.createSession(
      auth.userId ?? 'anonymous',
      auth.organizationId,
      title,
    );

    try {
      const result = await this.temporalService.startChatWorkflow({
        sessionId: session.id,
        organizationId: auth.organizationId,
        systemPrompt: SYSTEM_PROMPT,
      });
      await this.sessionRepository.setTemporalWorkflowId(session.id, result.workflowId);
      this.logger.log(
        `Started Temporal chat workflow ${result.workflowId} for session ${session.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to start Temporal chat workflow for session ${session.id}`, error);
      throw error;
    }

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
    try {
      await this.temporalService.terminateChatWorkflow(id);
    } catch {
      // Workflow may not exist or already be terminated
    }

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

  // --- Tool definitions endpoint (for Temporal worker) ---

  getToolDefinitionsForWorker(auth: AuthContext) {
    const toolDefs = this.studioMcpService.getToolDefinitions(auth);
    return toolDefs.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: Object.fromEntries(
        Object.entries(def.inputSchema).map(([key, zodType]) => [
          key,
          { type: 'string', description: (zodType as any)?.description ?? key },
        ]),
      ),
    }));
  }

  async executeToolForWorker(toolName: string, args: Record<string, unknown>, auth: AuthContext) {
    const toolDefs = this.studioMcpService.getToolDefinitions(auth);
    const def = toolDefs.find((t) => t.name === toolName);
    if (!def) {
      throw new Error(`Tool "${toolName}" not found`);
    }
    return def.execute(args);
  }

  // --- Streaming chat (Temporal-backed) ---
  //
  // The AI SDK useChat hook with DefaultChatTransport expects the AI SDK
  // data stream protocol.  Each line is `{typeId}:{jsonValue}\n`:
  //   0 = text part, 9 = tool call, a = tool result,
  //   e = step finish, d = finish message.
  // Content-Type must be `text/plain; charset=utf-8`.

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

    // Save the user message to DB
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      await this.sessionRepository.saveMessage(sessionId, {
        role: lastMessage.role,
        parts: lastMessage.parts,
      });
    }

    // Signal the Temporal workflow with the new message
    await this.temporalService.signalChatWorkflow(sessionId, {
      role: lastMessage.role,
      parts: lastMessage.parts,
    });

    // Set up AI SDK data stream protocol headers
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Vercel-AI-Data-Stream': 'v1',
    });

    // Subscribe to Redis pub/sub for real-time streaming
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };

    const subscription = this.chatStreamService.subscribe(sessionId, {
      onEvent: (event) => {
        try {
          if (event.type === 'text-delta' && typeof event.text === 'string') {
            res.write(`0:${JSON.stringify(event.text)}\n`);
          } else if (event.type === 'tool-call') {
            res.write(
              `9:${JSON.stringify({
                toolCallId: `call-${Date.now()}`,
                toolName: event.toolName,
                args: event.args ?? {},
              })}\n`,
            );
          } else if (event.type === 'tool-result') {
            res.write(
              `a:${JSON.stringify({
                toolCallId: `call-${Date.now()}`,
                toolName: event.toolName,
                result: event.result ?? {},
              })}\n`,
            );
          }
        } catch {
          // Best-effort streaming
        }
      },
      onComplete: () => {
        if (timer.id) clearTimeout(timer.id);
        const finishPayload = {
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
          isContinued: false,
        };
        res.write(`e:${JSON.stringify(finishPayload)}\n`);
        res.write(
          `d:${JSON.stringify({
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0 },
          })}\n`,
        );
        res.end();
      },
      onError: (err) => {
        if (timer.id) clearTimeout(timer.id);
        this.logger.error(`Stream error for session ${sessionId}:`, err);
        res.write(`0:${JSON.stringify(`Error: ${String(err)}`)}\n`);
        res.write(
          `e:${JSON.stringify({
            finishReason: 'error',
            usage: { promptTokens: 0, completionTokens: 0 },
            isContinued: false,
          })}\n`,
        );
        res.write(
          `d:${JSON.stringify({
            finishReason: 'error',
            usage: { promptTokens: 0, completionTokens: 0 },
          })}\n`,
        );
        res.end();
      },
    });

    // Timeout: if no completion in 2 minutes, end the stream
    timer.id = setTimeout(() => {
      subscription.unsubscribe();
      res.write(`0:${JSON.stringify('[Response timed out]')}\n`);
      res.write(
        `e:${JSON.stringify({
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
          isContinued: false,
        })}\n`,
      );
      res.write(
        `d:${JSON.stringify({
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
        })}\n`,
      );
      res.end();
    }, 120_000);

    // Handle client disconnect
    res.on('close', () => {
      if (timer.id) clearTimeout(timer.id);
      subscription.unsubscribe();
    });
  }
}
