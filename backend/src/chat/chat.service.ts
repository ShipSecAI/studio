import { randomUUID } from 'node:crypto';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatService.name);
  private reconcileInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionRepository: ChatSessionRepository,
    private readonly partialRepository: ChatPartialRepository,
    private readonly streamEventRepository: ChatStreamEventRepository,
    private readonly chatStreamService: ChatStreamService,
    private readonly temporalService: TemporalService,
  ) {}

  onModuleInit() {
    this.logger.log('Chat agent mode: Temporal (durable workflows)');
    this.reconcileInterval = setInterval(() => {
      this.reconcileZombieSessions().catch((err) => {
        this.logger.error('Zombie session reconciliation failed', err);
      });
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }
  }

  private async reconcileZombieSessions(): Promise<void> {
    const staleSessions = await this.sessionRepository.findStaleProcessingSessions(10);
    if (staleSessions.length === 0) return;

    for (const session of staleSessions) {
      try {
        await this.temporalService.queryChatStatus(session.id);
        // Workflow is still running — leave it alone
      } catch {
        // Workflow not found or dead — reset the session
        this.logger.warn(
          `Resetting zombie session ${session.id} (processingStatus=processing but workflow is gone)`,
        );
        await this.sessionRepository.completeRun(session.id);
      }
    }
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
    const activeRunId = session.activeRunId ?? null;
    const activeRunStartedAt =
      session.processingStatus === 'processing' && activeRunId
        ? await this.streamEventRepository.getRunStartedAt(sessionId, activeRunId)
        : null;
    return {
      processingStatus: session.processingStatus,
      activeRunId,
      activeRunStartedAt: activeRunStartedAt ? activeRunStartedAt.toISOString() : null,
    };
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

  // ---------------------------------------------------------------------------
  // Message sending (non-streaming - returns runId)
  // ---------------------------------------------------------------------------

  /**
   * Send a message and return the runId.
   * The actual streaming happens via GET /stream endpoint.
   * This allows multiple clients to attach to the same stream.
   */
  async sendMessage(
    sessionId: string,
    message: UIMessage,
    auth: AuthContext,
  ): Promise<{ runId: string }> {
    // Verify session ownership
    await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });

    // Start a new durable run for this message
    const runId = randomUUID();
    await this.sessionRepository.startRun(sessionId, runId);

    // Save the user message to DB
    if (message && message.role === 'user') {
      await this.sessionRepository.saveMessage(sessionId, {
        role: message.role,
        parts: message.parts,
      });
    }

    // Signal the Temporal workflow with the new message.
    // If the workflow timed out (idle 30 min), restart it with history from DB.
    try {
      await this.temporalService.signalChatWorkflow(
        sessionId,
        {
          id: message.id,
          role: message.role,
          parts: message.parts,
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
          id: message.id,
          role: message.role,
          parts: message.parts,
        },
        runId,
      );
    }

    return { runId };
  }

  // ---------------------------------------------------------------------------
  // Unified streaming endpoint (AI SDK v6 UIMessageChunk format)
  // ---------------------------------------------------------------------------

  /**
   * Stream events to SSE response in AI SDK v6 UIMessageChunk format.
   *
   * This is the unified streaming path used by:
   * - Tab 1 after sending a message (via DurableChatTransport.sendMessages)
   * - Tab 2+ joining mid-stream (via DurableChatTransport.reconnectToStream)
   * - Any tab after refresh (via DurableChatTransport.reconnectToStream)
   *
   * All clients receive identical events from:
   * 1. PostgreSQL replay (historical events)
   * 2. Redis pub/sub (live events)
   */
  async streamToResponse(
    sessionId: string,
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

    // Set up AI SDK v6 UI Message Stream headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Vercel-AI-UI-Message-Stream': 'v1',
      'X-Accel-Buffering': 'no',
      'X-Chat-Run-Id': targetRunId ?? '',
    });

    // If no active run, return idle immediately
    if (!targetRunId) {
      this.writeSseEvent(res, { type: 'status', status: 'idle' });
      this.endSseStream(res);
      return;
    }

    // Track text part IDs for proper streaming (AI SDK expects text-start/text-end pairs)
    let textPartCounter = 0;
    let currentTextId: string | null = null;
    const seenToolCalls = new Set<string>();

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

    let lastSeq = initialAfterSeq;
    let closed = false;
    const bufferedLiveEvents: Record<string, unknown>[] = [];

    const closeStream = () => {
      if (closed) return;
      closed = true;
      endTextPart();
      this.endSseStream(res);
    };

    const ensureToolInvocation = (
      toolCallId: string,
      toolName: string | undefined,
      input: unknown = {},
    ): void => {
      if (seenToolCalls.has(toolCallId)) return;
      this.writeSseEvent(res, {
        type: 'tool-input-start',
        toolCallId,
        toolName: toolName ?? 'unknown_tool',
      });
      this.writeSseEvent(res, {
        type: 'tool-input-available',
        toolCallId,
        toolName: toolName ?? 'unknown_tool',
        input,
      });
      seenToolCalls.add(toolCallId);
    };

    /**
     * Convert a worker event to AI SDK UIMessageChunk format and write to SSE.
     */
    const emitEvent = (event: Record<string, unknown>): boolean => {
      if (closed) return true;

      // Filter by runId
      if (event.runId !== targetRunId) {
        return false;
      }

      // Skip already-seen events
      const seq = typeof event.seq === 'number' ? event.seq : undefined;
      if (typeof seq === 'number' && seq <= lastSeq) {
        return false;
      }
      if (typeof seq === 'number') {
        lastSeq = seq;
      }

      // Convert to AI SDK format
      if (event.type === 'text-delta' && typeof event.text === 'string') {
        if (!currentTextId) startTextPart();
        this.writeSseEvent(res, {
          type: 'text-delta',
          id: currentTextId,
          delta: event.text,
        });
      } else if (event.type === 'tool-call') {
        endTextPart();
        const toolCallId = (event.toolCallId as string) ?? `call-${Date.now()}`;
        ensureToolInvocation(toolCallId, event.toolName as string | undefined, event.args ?? {});
      } else if (event.type === 'tool-result') {
        const toolCallId = (event.toolCallId as string) ?? `call-${Date.now()}`;
        ensureToolInvocation(toolCallId, event.toolName as string | undefined);
        this.writeSseEvent(res, {
          type: 'tool-output-available',
          toolCallId,
          output: event.result ?? {},
          preliminary: event.preliminary === true,
        });
      } else if (event.type === 'tool-progress') {
        const toolCallId = event.toolCallId as string | undefined;
        if (!toolCallId) return false;
        ensureToolInvocation(toolCallId, event.toolName as string | undefined);
        this.writeSseEvent(res, {
          type: 'tool-output-available',
          toolCallId,
          output: event.output ?? {},
          preliminary: true,
        });
      } else if (event.type === 'tool-error') {
        const toolCallId = event.toolCallId as string | undefined;
        if (!toolCallId) return false;
        ensureToolInvocation(toolCallId, event.toolName as string | undefined);
        this.writeSseEvent(res, {
          type: 'tool-output-error',
          toolCallId,
          errorText:
            typeof event.errorText === 'string' ? event.errorText : 'Tool execution failed',
        });
      } else if (event.type === 'status' && event.status === 'idle') {
        endTextPart();
        this.writeSseEvent(res, { type: 'status', status: 'idle' });
        return true; // Signal to close
      }

      return false;
    };

    // Subscribe to Redis for live events (buffered during replay)
    let replaying = true;
    const subscription = this.chatStreamService.subscribe(sessionId, {
      onEvent: (event) => {
        try {
          if (replaying) {
            bufferedLiveEvents.push(event as Record<string, unknown>);
            return;
          }
          const shouldClose = emitEvent(event as Record<string, unknown>);
          if (shouldClose) {
            closeStream();
            subscription.unsubscribe();
          }
        } catch {
          // Best-effort streaming
        }
      },
      onComplete: () => {
        closeStream();
      },
      onError: (err) => {
        this.logger.error(`Live stream error for session ${sessionId}:`, err);
        endTextPart();
        this.writeSseEvent(res, { type: 'error', errorText: String(err) });
        closeStream();
      },
    });

    // Replay historical events from PostgreSQL
    try {
      const replay = await this.streamEventRepository.listAfter(
        sessionId,
        targetRunId,
        initialAfterSeq,
      );

      for (const row of replay) {
        const event = {
          ...(row.event as Record<string, unknown>),
          runId: targetRunId,
          seq: row.seq,
        };
        const shouldClose = emitEvent(event);
        if (shouldClose) {
          subscription.unsubscribe();
          return;
        }
      }
    } catch (err) {
      this.logger.error(`Failed replay for session ${sessionId} run ${targetRunId}:`, err);
      endTextPart();
      this.writeSseEvent(res, { type: 'error', errorText: 'Failed to replay run events' });
      closeStream();
      subscription.unsubscribe();
      return;
    }

    // Process buffered live events (sorted by seq)
    bufferedLiveEvents.sort((a, b) => {
      const aSeq = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
      const bSeq = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
      return aSeq - bSeq;
    });
    replaying = false;

    for (const event of bufferedLiveEvents) {
      const shouldClose = emitEvent(event);
      if (shouldClose) {
        subscription.unsubscribe();
        return;
      }
    }

    // Check if run is already complete
    if (session.processingStatus !== 'processing' || session.activeRunId !== targetRunId) {
      endTextPart();
      this.writeSseEvent(res, { type: 'status', status: 'idle', runId: targetRunId });
      closeStream();
      subscription.unsubscribe();
      return;
    }

    // Timeout: if no completion in 5 minutes, end the stream
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      endTextPart();
      this.writeSseEvent(res, { type: 'status', status: 'timeout' });
      closeStream();
    }, 300_000);

    // Handle client disconnect
    res.on('close', () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    });
  }
}
