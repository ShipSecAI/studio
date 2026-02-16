import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import type { UIMessage } from 'ai';
import type { ServerResponse } from 'node:http';

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

  // --- Streaming chat (Temporal-backed) ---
  //
  // AI SDK v6 DefaultChatTransport expects the UI Message Stream protocol:
  //   Content-Type: text/event-stream
  //   Header: x-vercel-ai-ui-message-stream: v1
  //   Format: SSE lines — `data: {json}\n\n`
  //   Events: text-start, text-delta, text-end, tool-input-start,
  //           tool-input-available, tool-output-available, error
  //   End marker: `data: [DONE]\n\n`

  /** Write one SSE event */
  private writeSseEvent(res: ServerResponse, data: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** End SSE stream with [DONE] marker */
  private endSseStream(res: ServerResponse): void {
    res.write('data: [DONE]\n\n');
    res.end();
  }

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

    // Signal the Temporal workflow with the new message.
    // If the workflow timed out (idle 30 min), restart it with history from DB.
    try {
      await this.temporalService.signalChatWorkflow(sessionId, {
        role: lastMessage.role,
        parts: lastMessage.parts,
      });
    } catch (signalError) {
      this.logger.warn(
        `Signal failed for session ${sessionId}, workflow may have timed out. Restarting...`,
        signalError,
      );

      // Load existing messages from DB so the new workflow has full context
      const existingMessages = await this.sessionRepository.getMessages(sessionId);
      const initialMessages = existingMessages.map((m) => ({
        role: m.role,
        parts: m.parts,
      }));

      // Start a fresh workflow (Temporal allows reuse of the workflow ID once completed)
      const result = await this.temporalService.startChatWorkflow({
        sessionId,
        organizationId: auth.organizationId,
        systemPrompt: SYSTEM_PROMPT,
        initialMessages,
      });
      await this.sessionRepository.setTemporalWorkflowId(sessionId, result.workflowId);
      this.logger.log(
        `Restarted Temporal chat workflow ${result.workflowId} for session ${sessionId} with ${initialMessages.length} existing messages`,
      );

      // Now signal the newly started workflow
      await this.temporalService.signalChatWorkflow(sessionId, {
        role: lastMessage.role,
        parts: lastMessage.parts,
      });
    }

    // Set up AI SDK v6 UI Message Stream headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Vercel-AI-UI-Message-Stream': 'v1',
      'X-Accel-Buffering': 'no',
    });

    // Track state for text part interleaving with tools.
    // Each text segment between tool calls gets its own text part ID so
    // the AI SDK renders them inline in the correct order.
    let textPartCounter = 0;
    let currentTextId: string | null = null;

    const startTextPart = (): string => {
      textPartCounter++;
      currentTextId = `text-${Date.now()}-${textPartCounter}`;
      this.writeSseEvent(res, { type: 'text-start', id: currentTextId });
      return currentTextId;
    };

    const endTextPart = (): void => {
      if (currentTextId) {
        this.writeSseEvent(res, { type: 'text-end', id: currentTextId });
        currentTextId = null;
      }
    };

    // Subscribe to Redis pub/sub for real-time streaming
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };

    const subscription = this.chatStreamService.subscribe(sessionId, {
      onEvent: (event) => {
        try {
          if (event.type === 'text-delta' && typeof event.text === 'string') {
            if (!currentTextId) startTextPart();
            this.writeSseEvent(res, { type: 'text-delta', id: currentTextId, delta: event.text });
          } else if (event.type === 'tool-call') {
            // End any open text part so the tool renders inline after the text
            endTextPart();
            const toolCallId = event.toolCallId ?? `call-${Date.now()}`;
            this.writeSseEvent(res, {
              type: 'tool-input-start',
              toolCallId,
              toolName: event.toolName,
            });
            this.writeSseEvent(res, {
              type: 'tool-input-available',
              toolCallId,
              toolName: event.toolName,
              input: event.args ?? {},
            });
          } else if (event.type === 'tool-result') {
            const toolCallId = event.toolCallId ?? `call-${Date.now()}`;
            this.writeSseEvent(res, {
              type: 'tool-output-available',
              toolCallId,
              output: event.result ?? {},
            });
          } else if (event.type === 'title-update' && typeof event.title === 'string') {
            // Title updates are saved to DB by the worker activity.
            // Don't send via SSE — 'metadata' is not a valid AI SDK v6 stream part type.
            // The frontend refreshes the session list to pick up title changes.
          }
        } catch {
          // Best-effort streaming
        }
      },
      onComplete: () => {
        if (timer.id) clearTimeout(timer.id);
        endTextPart();
        this.endSseStream(res);
      },
      onError: (err) => {
        if (timer.id) clearTimeout(timer.id);
        this.logger.error(`Stream error for session ${sessionId}:`, err);
        this.writeSseEvent(res, { type: 'error', errorText: String(err) });
        this.endSseStream(res);
      },
    });

    // Timeout: if no completion in 2 minutes, end the stream
    timer.id = setTimeout(() => {
      subscription.unsubscribe();
      const timeoutId = currentTextId ?? startTextPart();
      this.writeSseEvent(res, {
        type: 'text-delta',
        id: timeoutId,
        delta: '[Response timed out]',
      });
      endTextPart();
      this.endSseStream(res);
    }, 120_000);

    // Handle client disconnect
    res.on('close', () => {
      if (timer.id) clearTimeout(timer.id);
      subscription.unsubscribe();
    });
  }
}
