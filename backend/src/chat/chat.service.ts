import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleInit, Logger, NotFoundException } from '@nestjs/common';
import type { UIMessage } from 'ai';
import type { ServerResponse } from 'node:http';

import { ChatSessionRepository } from './chat-session.repository';
import { ChatPartialRepository } from './chat-partial.repository';
import { ChatStreamEventRepository } from './chat-stream-event.repository';
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
    private readonly partialRepository: ChatPartialRepository,
    private readonly streamEventRepository: ChatStreamEventRepository,
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
      processingStatus: session.processingStatus,
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
      processingStatus: s.processingStatus,
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
      processingStatus: session.processingStatus,
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
      processingStatus: session.processingStatus,
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
    return messages.map((m: any) => ({
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

  // ---------------------------------------------------------------------------
  // Detachable session support
  // ---------------------------------------------------------------------------

  async getProcessingStatus(sessionId: string, auth: AuthContext) {
    const session = await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    return { processingStatus: session.processingStatus, activeRunId: session.activeRunId ?? null };
  }

  async getRunEvents(sessionId: string, runId: string, afterSeq: number, auth: AuthContext) {
    await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    const rows = await this.streamEventRepository.listAfter(sessionId, runId, afterSeq);
    return {
      runId,
      events: rows.map((row) => ({
        ...(row.event as Record<string, unknown>),
        runId,
        seq: row.seq,
      })),
    };
  }

  async getPartialResponse(sessionId: string, auth: AuthContext) {
    await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    const partial = await this.partialRepository.get(sessionId);
    if (!partial) {
      throw new NotFoundException('No partial response in progress');
    }
    return { parts: partial.parts, updatedAt: partial.updatedAt };
  }

  /** Internal: called by worker to flush accumulated partial response */
  async upsertPartialResponse(sessionId: string, parts: unknown[]) {
    await this.partialRepository.upsert(sessionId, parts);
  }

  /** Internal: called by worker for each durable stream event */
  async appendStreamEvent(sessionId: string, runId: string, event: Record<string, unknown>) {
    return this.streamEventRepository.append(sessionId, runId, event);
  }

  /** Internal: called by worker on completion/error to clean up */
  async clearPartialResponse(sessionId: string, runId?: string) {
    await this.partialRepository.delete(sessionId);
    await this.sessionRepository.completeRun(sessionId, runId);
  }

  /** Stream live pub/sub events to an SSE or NDJSON HTTP response */
  async streamLiveToResponse(
    sessionId: string,
    format: 'sse' | 'ndjson',
    auth: AuthContext,
    res: ServerResponse,
    options: { runId?: string; afterSeq?: number } = {},
  ): Promise<void> {
    const session = await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
    const targetRunId = options.runId ?? session.activeRunId ?? null;
    const initialAfterSeq = Math.max(0, options.afterSeq ?? 0);

    const contentType = format === 'ndjson' ? 'application/x-ndjson' : 'text/event-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!targetRunId) {
      if (format === 'ndjson') {
        res.write(JSON.stringify({ type: 'status', status: 'idle' }) + '\n');
      } else {
        res.write(`data: ${JSON.stringify({ type: 'status', status: 'idle' })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
      res.end();
      return;
    }

    const writeEvent = (data: string) => {
      if (format === 'ndjson') {
        res.write(data + '\n');
      } else {
        res.write(`data: ${data}\n\n`);
      }
    };

    let lastSeq = initialAfterSeq;
    let replaying = true;
    let closed = false;
    const bufferedLiveEvents: Record<string, unknown>[] = [];

    const closeStream = () => {
      if (closed) return;
      closed = true;
      if (format === 'sse') {
        res.write('data: [DONE]\n\n');
      }
      res.end();
    };

    const maybeEmitEvent = (event: Record<string, unknown>) => {
      if (event.runId !== targetRunId) {
        return;
      }
      const seq = typeof event.seq === 'number' ? event.seq : undefined;
      if (typeof seq === 'number' && seq <= lastSeq) {
        return;
      }
      if (typeof seq === 'number') {
        lastSeq = seq;
      }
      writeEvent(JSON.stringify(event));
      if (event.type === 'status' && event.status === 'idle') {
        closeStream();
      }
    };

    const subscription = this.chatStreamService.subscribe(sessionId, {
      onEvent: (event) => {
        try {
          if (replaying) {
            bufferedLiveEvents.push(event as Record<string, unknown>);
            return;
          }
          maybeEmitEvent(event as Record<string, unknown>);
        } catch {
          // Best-effort streaming
        }
      },
      onComplete: () => {
        closeStream();
      },
      onError: (err) => {
        this.logger.error(`Live stream error for session ${sessionId}:`, err);
        writeEvent(JSON.stringify({ type: 'error', errorText: String(err) }));
        closeStream();
      },
    });

    try {
      const replay = await this.streamEventRepository.listAfter(sessionId, targetRunId, lastSeq);
      for (const row of replay) {
        maybeEmitEvent({
          ...(row.event as Record<string, unknown>),
          runId: targetRunId,
          seq: row.seq,
        });
        if (closed) {
          subscription.unsubscribe();
          return;
        }
      }
    } catch (err) {
      this.logger.error(`Failed replay for session ${sessionId} run ${targetRunId}:`, err);
      writeEvent(JSON.stringify({ type: 'error', errorText: 'Failed to replay run events' }));
      closeStream();
      subscription.unsubscribe();
      return;
    }

    bufferedLiveEvents.sort((a, b) => {
      const aSeq = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
      const bSeq = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
      return aSeq - bSeq;
    });
    replaying = false;
    for (const event of bufferedLiveEvents) {
      maybeEmitEvent(event);
      if (closed) {
        subscription.unsubscribe();
        return;
      }
    }

    if (session.processingStatus !== 'processing' || session.activeRunId !== targetRunId) {
      writeEvent(JSON.stringify({ type: 'status', status: 'idle', runId: targetRunId }));
      closeStream();
      subscription.unsubscribe();
      return;
    }

    // Timeout: if no completion in 5 minutes, end the stream
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      writeEvent(JSON.stringify({ type: 'status', status: 'timeout' }));
      closeStream();
    }, 300_000);

    res.on('close', () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    });
  }

  // ---------------------------------------------------------------------------
  // Streaming chat (Temporal-backed, original active-tab flow)
  // ---------------------------------------------------------------------------

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

    // Start a new durable run for this message and expose the run ID to all clients.
    const runId = randomUUID();
    await this.sessionRepository.startRun(sessionId, runId);

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
      await this.temporalService.signalChatWorkflow(
        sessionId,
        {
          id: lastMessage.id,
          role: lastMessage.role,
          parts: lastMessage.parts,
        },
        runId,
      );
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
      await this.temporalService.signalChatWorkflow(
        sessionId,
        {
          id: lastMessage.id,
          role: lastMessage.role,
          parts: lastMessage.parts,
        },
        runId,
      );
    }

    // Set up AI SDK v6 UI Message Stream headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Vercel-AI-UI-Message-Stream': 'v1',
      'X-Accel-Buffering': 'no',
      'X-Chat-Run-Id': runId,
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
          if ((event as any).runId !== runId) {
            return;
          }
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
              preliminary: event.preliminary === true,
            });
          } else if (event.type === 'tool-progress') {
            const toolCallId = event.toolCallId;
            if (typeof toolCallId !== 'string') return;
            this.writeSseEvent(res, {
              type: 'tool-output-available',
              toolCallId,
              output: event.output ?? {},
              preliminary: true,
            });
          } else if (event.type === 'tool-error') {
            const toolCallId = event.toolCallId;
            if (typeof toolCallId !== 'string') return;
            this.writeSseEvent(res, {
              type: 'tool-output-error',
              toolCallId,
              errorText:
                typeof event.errorText === 'string' ? event.errorText : 'Tool execution failed',
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
      shouldComplete: (event) =>
        event.type === 'status' && event.status === 'idle' && (event as any).runId === runId,
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
