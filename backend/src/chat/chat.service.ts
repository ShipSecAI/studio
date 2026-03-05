import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { readUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';

import { ChatSessionRepository } from './chat-session.repository';
import { ChatTurnRepository } from './chat-turn.repository';
import { ChatSessionEventRepository } from './chat-session-event.repository';
import { ChatTurnDraftRepository } from './chat-turn-draft.repository';
import { ChatStreamService } from './chat-stream.service';
import { TemporalService } from '../temporal/temporal.service';
import { applyTurnStatus } from './chat-turn-status.util';
import type { AuthContext } from '../auth/types';

const SYSTEM_PROMPT = `You are ShipSec AI, an intelligent assistant embedded in ShipSec Studio.
You help users manage their automation workflows. You can:
- List, inspect, and run workflows
- Check run status and results
- Browse available components

Be concise and helpful. When a user asks to run a workflow, confirm the workflow name
and any required inputs before executing. Always show run IDs so users can track progress.`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly sessionRepository: ChatSessionRepository,
    private readonly turnRepository: ChatTurnRepository,
    private readonly sessionEventRepository: ChatSessionEventRepository,
    private readonly turnDraftRepository: ChatTurnDraftRepository,
    private readonly chatStreamService: ChatStreamService,
    private readonly temporalService: TemporalService,
  ) {}

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
      // Workflow may not exist or already be terminated.
    }

    await this.sessionRepository.deleteSession(id, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
  }

  async getMessages(sessionId: string, auth: AuthContext) {
    await this.assertSessionAccess(sessionId, auth);
    const messages = await this.sessionRepository.getMessages(sessionId);

    return messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    }));
  }

  async enqueueTurn(
    sessionId: string,
    input: { message: string; clientMessageId?: string },
    auth: AuthContext,
  ) {
    const session = await this.assertSessionAccess(sessionId, auth);

    const queued = await this.turnRepository.enqueueTurnWithUserMessage({
      sessionId,
      message: input.message,
      clientMessageId: input.clientMessageId,
    });

    let runId = session.activeRunId ?? null;
    let queuedOnExistingRun = Boolean(runId);
    let createdRun = false;

    if (!runId) {
      runId = randomUUID();
      createdRun = true;
      await this.sessionRepository.startRun(sessionId, runId);
    }

    const signalTurn = async (targetRunId: string) => {
      await this.temporalService.signalChatWorkflow(
        sessionId,
        {
          id: input.clientMessageId,
          role: 'user',
          parts: [{ type: 'text', text: input.message }],
        },
        targetRunId,
        {
          turnId: queued.turn.id,
          queuedAt: queued.turn.queuedAt.toISOString(),
        },
      );
    };

    try {
      await signalTurn(runId);
    } catch (error) {
      if (this.isTemporalWorkflowClosedError(error)) {
        this.logger.warn(
          `Chat workflow for session ${sessionId} closed while enqueueing turn ${queued.turn.id}; recovering with a new run`,
        );

        await this.sessionRepository.completeRun(sessionId, runId);
        await this.ensureChatWorkflowRunning(sessionId, session.organizationId);

        runId = randomUUID();
        queuedOnExistingRun = false;
        createdRun = true;
        await this.sessionRepository.startRun(sessionId, runId);

        try {
          await signalTurn(runId);
        } catch (retryError) {
          if (createdRun) {
            await this.sessionRepository.completeRun(sessionId, runId);
          }
          throw retryError;
        }
      } else {
        if (createdRun) {
          await this.sessionRepository.completeRun(sessionId, runId);
        }
        throw error;
      }
    }

    if (queued.created) {
      await this.appendInternalEvent(sessionId, {
        turnId: queued.turn.id,
        runId,
        eventId: `queued:${queued.turn.id}`,
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: queued.turn.id,
            status: 'queued',
            queuedAt: queued.turn.queuedAt.toISOString(),
            preview: queued.turn.userMessage,
          },
        },
      });
    }

    const [queuedTurns, lastSeq] = await Promise.all([
      this.turnRepository.listQueuedTurns(sessionId),
      this.sessionEventRepository.getLastSeq(sessionId),
    ]);

    return {
      turnId: queued.turn.id,
      status: queued.turn.status,
      preview: queued.turn.userMessage,
      queuedAt: queued.turn.queuedAt,
      position: queued.position,
      queuePosition: queued.position,
      queued: queuedOnExistingRun,
      ...(queuedOnExistingRun ? { activeRunId: runId } : { runId }),
      pendingCount: queuedTurns.length,
      afterSeq: lastSeq,
      lastSeq,
    };
  }

  async sendMessage(sessionId: string, message: unknown, auth: AuthContext) {
    const text = this.extractTextFromUIMessage(message);
    if (!text) {
      return { error: 'No text message provided' };
    }

    return this.enqueueTurn(sessionId, { message: text }, auth);
  }

  async steerSession(
    sessionId: string,
    targetTurnId: string | undefined,
    auth: AuthContext,
  ): Promise<{ ok: boolean; targetTurnId: string | null; interruptedTurnId?: string }> {
    await this.assertSessionAccess(sessionId, auth);

    if (targetTurnId) {
      await this.turnRepository.getTurn(sessionId, targetTurnId);
    }

    await this.sessionRepository.setSteerIntent(sessionId, targetTurnId ?? null);
    if (targetTurnId) {
      await this.temporalService.signalChatSteerTurn(sessionId, targetTurnId);
    }

    // Always interrupt — workflow handler is idempotent (activeScope?.cancel() is a no-op when null)
    await this.temporalService.signalChatInterrupt(sessionId);

    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);
    return {
      ok: true,
      targetTurnId: targetTurnId ?? null,
      interruptedTurnId: runningTurn?.id,
    };
  }

  async interruptGeneration(
    sessionId: string,
    auth: AuthContext,
  ): Promise<{ ok: boolean; interruptedTurnId?: string }> {
    await this.assertSessionAccess(sessionId, auth);
    // Always signal — workflow handler is idempotent (activeScope?.cancel() is a no-op when null)
    await this.temporalService.signalChatInterrupt(sessionId);
    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);

    // Persist "stopping" state so all tabs see it immediately via SSE
    await this.sessionRepository.setProcessingStatus(sessionId, 'stopping');

    if (runningTurn) {
      // Emit stopping event so all SSE clients show "Stopping..." immediately
      await this.appendInternalEvent(sessionId, {
        turnId: runningTurn.id,
        eventId: `stopping:${runningTurn.id}`,
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: runningTurn.id,
            status: 'stopping',
          },
        },
      });
    }

    return { ok: true, interruptedTurnId: runningTurn?.id };
  }

  async getState(sessionId: string, auth: AuthContext) {
    const session = await this.assertSessionAccess(sessionId, auth);
    const [messages, activeTurn, latestTurn, queuedTurns, lastSeq] = await Promise.all([
      this.sessionRepository.getMessages(sessionId),
      this.turnRepository.getRunningTurn(sessionId),
      this.turnRepository.getLatestTurn(sessionId),
      this.turnRepository.listQueuedTurns(sessionId),
      this.sessionEventRepository.getLastSeq(sessionId),
    ]);

    let hydratedMessages = messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      createdAt: m.createdAt,
    }));

    const recoveryTurn = activeTurn ?? latestTurn;
    const lastHydrated = hydratedMessages[hydratedMessages.length - 1];
    const shouldRecoverAssistant =
      Boolean(recoveryTurn) &&
      (!lastHydrated || lastHydrated.role !== 'assistant') &&
      recoveryTurn?.status !== 'queued';

    if (shouldRecoverAssistant && recoveryTurn) {
      const recovered = await this.recoverAssistantMessageFromTurnEvents(
        sessionId,
        recoveryTurn.id,
        recoveryTurn.startedAt ?? recoveryTurn.endedAt ?? recoveryTurn.queuedAt ?? null,
      );
      if (recovered) {
        hydratedMessages = [...hydratedMessages, recovered];
      }
    }

    const queue = queuedTurns.map((turn, index) => ({
      turnId: turn.id,
      clientMessageId: turn.clientMessageId,
      preview: turn.userMessage,
      queuePosition: index + 1,
      status: turn.status,
      queuedAt: turn.queuedAt,
      startedAt: turn.startedAt,
      completedAt: turn.endedAt,
    }));
    const parsedGenerationId =
      activeTurn?.generationId && Number.isFinite(Number(activeTurn.generationId))
        ? Number(activeTurn.generationId)
        : null;
    const processingStatus =
      activeTurn || queue.length > 0 || session.processingStatus === 'processing'
        ? 'processing'
        : 'idle';
    const activeRunId = activeTurn?.runId ?? session.activeRunId ?? null;

    return {
      messages: hydratedMessages,
      activeTurn: activeTurn
        ? {
            turnId: activeTurn.id,
            status: activeTurn.status,
            runId: activeTurn.runId,
            generationId: activeTurn.generationId,
            startedAt: activeTurn.startedAt,
          }
        : null,
      activeRunId,
      activeRunStartedAt: activeTurn?.startedAt ?? null,
      generationId: parsedGenerationId,
      pendingCount: queue.length,
      steerTargetTurnId: session.steerTargetTurnId ?? null,
      queue,
      queuedTurns: queue,
      queueOrder: queue.map((turn) => turn.turnId),
      afterSeq: lastSeq,
      lastSeq,
      processingStatus,
    };
  }

  private async recoverAssistantMessageFromTurnEvents(
    sessionId: string,
    turnId: string,
    createdAt: Date | null,
  ): Promise<{ id: string; role: 'assistant'; parts: unknown[]; createdAt: Date } | null> {
    const rows = await this.sessionEventRepository.listByTurn(sessionId, turnId);
    if (rows.length === 0) {
      return null;
    }

    const chunks = rows
      .map((row) => row.chunk)
      .filter((chunk): chunk is UIMessageChunk => Boolean(chunk) && typeof chunk === 'object');

    if (chunks.length === 0) {
      return null;
    }

    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    let latestSnapshot: UIMessage | null = null;
    try {
      for await (const snapshot of readUIMessageStream({ stream })) {
        latestSnapshot = snapshot;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to reconstruct assistant snapshot for session=${sessionId} turn=${turnId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    if (!latestSnapshot) {
      return null;
    }

    const parts = (latestSnapshot.parts ?? []).filter((part) => {
      if (!part || typeof part !== 'object') return false;
      const typed = part as { type?: string; text?: string };
      if (!typed.type) return false;
      if (typed.type === 'data-turn-status') return false;
      if (typed.type === 'text') {
        return typeof typed.text === 'string' && typed.text.length > 0;
      }
      return true;
    });

    if (parts.length === 0) {
      return null;
    }

    return {
      id: `turn-${turnId}`,
      role: 'assistant',
      parts: parts as unknown[],
      createdAt: createdAt ?? new Date(),
    };
  }

  async getProcessingStatus(sessionId: string, auth: AuthContext) {
    return this.getState(sessionId, auth);
  }

  async getRunEvents(
    sessionId: string,
    runId: string | undefined,
    afterSeq: number,
    auth: AuthContext,
  ) {
    await this.assertSessionAccess(sessionId, auth);
    const rows = await this.sessionEventRepository.listAfter(
      sessionId,
      afterSeq,
      500,
      runId?.trim() || undefined,
    );

    return {
      events: rows.map((row) => ({
        seq: row.seq,
        turnId: row.turnId,
        runId: row.runId,
        generationId: row.generationId,
        eventId: row.eventId,
        chunk: row.chunk,
      })),
    };
  }

  async completeRun(sessionId: string, runId?: string): Promise<void> {
    // Find the active turn — check running first, fall back to latest turn.
    // The Kafka consumer may have already marked the turn as interrupted/completed
    // before this method is called, so getRunningTurn() can return null.
    const activeTurn =
      (await this.turnRepository.getRunningTurn(sessionId)) ??
      (await this.turnRepository.getLatestTurn(sessionId));

    await this.sessionRepository.completeRun(sessionId, runId);
    await this.sessionRepository.clearSteerIntent(sessionId);

    // Emit a reliable terminal event via Redis so all SSE clients close their turn streams
    // and clear the "Stopping..." state. Duplicate events are harmless.
    if (activeTurn) {
      const isTerminal = ['completed', 'interrupted', 'failed', 'cancelled'].includes(
        activeTurn.status,
      );
      const status = isTerminal ? activeTurn.status : 'completed';
      await this.appendInternalEvent(sessionId, {
        turnId: activeTurn.id,
        runId,
        eventId: `complete-fallback:${activeTurn.id}`,
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: activeTurn.id,
            status,
            endedAt: new Date().toISOString(),
            processingStatus: 'idle',
          },
        },
      }).catch((err) => {
        this.logger.warn(`Failed to emit terminal event for turn ${activeTurn.id}: ${err}`);
      });
    }
  }

  async appendInternalEvent(
    sessionId: string,
    input: {
      turnId: string;
      runId?: string;
      generationId?: string | number;
      eventId: string;
      chunk: Record<string, unknown>;
    },
  ): Promise<number> {
    const turn = await this.turnRepository.getTurn(sessionId, input.turnId);
    const generationId =
      input.generationId === undefined || input.generationId === null
        ? undefined
        : String(input.generationId);

    const seq = await this.sessionEventRepository.append({
      sessionId,
      turnId: input.turnId,
      runId: input.runId,
      generationId,
      eventId: input.eventId,
      chunk: input.chunk,
    });

    await this.turnDraftRepository.upsert(turn.id, input.chunk, seq);
    await this.applyTurnStatusFromChunk(sessionId, turn.id, input.chunk, input.runId, generationId);

    await this.chatStreamService.publish(sessionId, {
      seq,
      turnId: input.turnId,
      runId: input.runId ?? null,
      generationId: generationId ?? null,
      eventId: input.eventId,
      chunk: input.chunk,
    });

    return seq;
  }

  async appendLegacyStreamEvent(sessionId: string, runId: string, event: Record<string, unknown>) {
    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);
    const queuedTurn =
      runningTurn ?? (await this.turnRepository.listQueuedTurns(sessionId, 1))[0] ?? null;

    if (!queuedTurn) {
      throw new Error(`No active or queued turn for session ${sessionId}`);
    }

    const eventId = this.resolveLegacyEventId(event, runId);
    return this.appendInternalEvent(sessionId, {
      turnId: queuedTurn.id,
      runId,
      generationId:
        typeof event.generationId === 'string' || typeof event.generationId === 'number'
          ? event.generationId
          : undefined,
      eventId,
      chunk: event,
    });
  }

  async streamToResponse(
    sessionId: string,
    auth: AuthContext,
    res: ServerResponse,
    options: { afterSeq?: number } = {},
  ): Promise<void> {
    await this.assertSessionAccess(sessionId, auth);

    let lastSeq = Math.max(0, options.afterSeq ?? 0);
    let closed = false;

    const writeChunk = (chunk: Record<string, unknown>) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    const close = () => {
      closed = true;
    };

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Vercel-AI-UI-Message-Stream': 'v1',
      'X-Accel-Buffering': 'no',
    });

    // Replay all session events (no runId filtering — session-level SSE)
    const replayRows = await this.sessionEventRepository.listAfter(sessionId, lastSeq, 500);
    for (const row of replayRows) {
      lastSeq = row.seq;
      const chunk = this.decorateStreamChunk(row.chunk, {
        seq: row.seq,
        runId: row.runId,
        generationId: row.generationId,
      });
      writeChunk(chunk);
    }

    if (!this.chatStreamService.isAvailable()) {
      await this.streamWithPollingFallback(sessionId, res, lastSeq, writeChunk, close);
      return;
    }

    // Long-lived SSE — stays open until client disconnects (no auto-close on turn completion)
    await new Promise<void>((resolve) => {
      const heartbeat = setInterval(() => {
        if (!closed) {
          res.write(': ping\n\n');
        }
      }, 15000);

      const subscription = this.chatStreamService.subscribe(sessionId, {
        onEvent: (event) => {
          const maybeSeq = typeof event.seq === 'number' ? event.seq : null;
          if (maybeSeq != null && maybeSeq <= lastSeq) {
            return;
          }

          if (maybeSeq != null) {
            lastSeq = maybeSeq;
          }

          const rawChunk =
            event.chunk && typeof event.chunk === 'object'
              ? (event.chunk as Record<string, unknown>)
              : (event as Record<string, unknown>);
          const chunk = this.decorateStreamChunk(rawChunk, {
            seq: maybeSeq ?? undefined,
            runId: typeof event.runId === 'string' ? event.runId : undefined,
            generationId: typeof event.generationId === 'string' ? event.generationId : undefined,
          });
          writeChunk(chunk);
        },
        onComplete: () => {
          clearInterval(heartbeat);
          close();
          resolve();
        },
        onError: (error) => {
          this.logger.error(`Chat stream subscription error for ${sessionId}`, error);
          clearInterval(heartbeat);
          if (!closed) {
            writeChunk({ type: 'error', errorText: String(error) });
          }
          close();
          resolve();
        },
      });

      res.on('close', () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        close();
        resolve();
      });
    });
  }

  private async streamWithPollingFallback(
    sessionId: string,
    res: ServerResponse,
    initialSeq: number,
    writeChunk: (chunk: Record<string, unknown>) => void,
    close: () => void,
  ): Promise<void> {
    let lastSeq = initialSeq;

    await new Promise<void>((resolve) => {
      const heartbeat = setInterval(() => {
        if (!res.closed) {
          res.write(': ping\n\n');
        }
      }, 15000);

      const poll = setInterval(async () => {
        try {
          const rows = await this.sessionEventRepository.listAfter(sessionId, lastSeq, 500);
          for (const row of rows) {
            lastSeq = row.seq;
            const chunk = this.decorateStreamChunk(row.chunk, {
              seq: row.seq,
              runId: row.runId,
              generationId: row.generationId,
            });
            writeChunk(chunk);
          }
        } catch (error) {
          this.logger.error(`Polling stream fallback failed for ${sessionId}`, error);
        }
      }, 250);

      res.on('close', () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        close();
        resolve();
      });
    });
  }

  private decorateStreamChunk(
    chunk: Record<string, unknown>,
    metadata: { seq?: number; runId?: string | null; generationId?: string | null },
  ): Record<string, unknown> {
    const baseChunk: Record<string, unknown> = {
      ...chunk,
      ...(metadata.seq != null ? { seq: metadata.seq } : {}),
      ...(metadata.runId ? { runId: metadata.runId } : {}),
      ...(metadata.generationId ? { generationId: metadata.generationId } : {}),
    };

    if (baseChunk.type !== 'data-turn-status') {
      return baseChunk;
    }

    const rawData =
      baseChunk.data && typeof baseChunk.data === 'object'
        ? (baseChunk.data as Record<string, unknown>)
        : {};

    return {
      ...baseChunk,
      data: {
        ...rawData,
        ...(metadata.seq != null ? { seq: metadata.seq } : {}),
        ...(metadata.runId ? { activeRunId: metadata.runId, runId: metadata.runId } : {}),
        ...(metadata.generationId ? { generationId: metadata.generationId } : {}),
      },
    };
  }

  private async applyTurnStatusFromChunk(
    sessionId: string,
    turnId: string,
    chunk: Record<string, unknown>,
    runId?: string,
    generationId?: string,
  ): Promise<void> {
    await applyTurnStatus(
      {
        turnRepository: this.turnRepository,
        sessionRepository: this.sessionRepository,
      },
      sessionId,
      turnId,
      chunk,
      runId,
      generationId,
    );
  }

  private async ensureChatWorkflowRunning(
    sessionId: string,
    organizationId: string | null | undefined,
  ): Promise<void> {
    try {
      await this.temporalService.startChatWorkflow({
        sessionId,
        organizationId,
        systemPrompt: SYSTEM_PROMPT,
      });
    } catch (error) {
      if (this.isTemporalWorkflowAlreadyStartedError(error)) {
        return;
      }
      throw error;
    }
  }

  private isTemporalWorkflowAlreadyStartedError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('already started');
  }

  private isTemporalWorkflowClosedError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes('workflow execution already completed') ||
      message.includes('workflow not found') ||
      message.includes('execution not found')
    );
  }

  private async assertSessionAccess(sessionId: string, auth: AuthContext) {
    return this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
  }

  private extractTextFromUIMessage(message: unknown): string {
    if (!message || typeof message !== 'object') {
      return '';
    }

    const msg = message as { parts?: unknown[] };
    if (!Array.isArray(msg.parts)) {
      return '';
    }

    const textParts = msg.parts
      .filter((part) => part && typeof part === 'object')
      .map((part) => part as { type?: string; text?: string })
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text!.trim())
      .filter(Boolean);

    return textParts.join('\n').trim();
  }

  private resolveLegacyEventId(event: Record<string, unknown>, runId: string): string {
    if (typeof event.eventId === 'string' && event.eventId.length > 0) {
      return event.eventId;
    }

    if (typeof event.id === 'string' && event.id.length > 0) {
      return event.id;
    }

    return `${runId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
}
