import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import { ChatSessionRepository } from './chat-session.repository';
import { ChatTurnRepository, type ChatTurnStatus } from './chat-turn.repository';
import { ChatSessionEventRepository } from './chat-session-event.repository';
import { ChatTurnDraftRepository } from './chat-turn-draft.repository';
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
    const isQueued = Boolean(runId);
    const createdRun = !runId;

    if (!runId) {
      runId = randomUUID();
      await this.sessionRepository.startRun(sessionId, runId);
    }

    try {
      await this.temporalService.signalChatWorkflow(
        sessionId,
        {
          id: input.clientMessageId,
          role: 'user',
          parts: [{ type: 'text', text: input.message }],
        },
        runId,
        {
          turnId: queued.turn.id,
          queuedAt: queued.turn.queuedAt.toISOString(),
        },
      );
    } catch (error) {
      if (createdRun) {
        await this.sessionRepository.completeRun(sessionId, runId);
      }
      throw error;
    }

    const [queuedTurns, lastSeq] = await Promise.all([
      this.turnRepository.listQueuedTurns(sessionId),
      this.sessionEventRepository.getLastSeq(sessionId),
    ]);

    return {
      turnId: queued.turn.id,
      status: queued.turn.status,
      queuedAt: queued.turn.queuedAt,
      position: queued.position,
      queued: isQueued,
      ...(isQueued ? { activeRunId: runId } : { runId }),
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

    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);
    if (!runningTurn) {
      return { ok: true, targetTurnId: targetTurnId ?? null };
    }

    await this.temporalService.signalChatInterrupt(sessionId);

    return {
      ok: true,
      targetTurnId: targetTurnId ?? null,
      interruptedTurnId: runningTurn.id,
    };
  }

  async interruptGeneration(
    sessionId: string,
    auth: AuthContext,
  ): Promise<{ ok: boolean; interruptedTurnId?: string }> {
    await this.assertSessionAccess(sessionId, auth);
    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);

    if (!runningTurn) {
      return { ok: false };
    }

    await this.temporalService.signalChatInterrupt(sessionId);

    return { ok: true, interruptedTurnId: runningTurn.id };
  }

  async getState(sessionId: string, auth: AuthContext) {
    const session = await this.assertSessionAccess(sessionId, auth);
    const [messages, activeTurn, queuedTurns, lastSeq] = await Promise.all([
      this.sessionRepository.getMessages(sessionId),
      this.turnRepository.getRunningTurn(sessionId),
      this.turnRepository.listQueuedTurns(sessionId),
      this.sessionEventRepository.getLastSeq(sessionId),
    ]);

    const queue = queuedTurns.map((turn, index) => ({
      turnId: turn.id,
      clientMessageId: turn.clientMessageId,
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
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        createdAt: m.createdAt,
      })),
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

  async getProcessingStatus(sessionId: string, auth: AuthContext) {
    return this.getState(sessionId, auth);
  }

  async getRunEvents(
    sessionId: string,
    _runId: string | undefined,
    afterSeq: number,
    auth: AuthContext,
  ) {
    await this.assertSessionAccess(sessionId, auth);
    const rows = await this.sessionEventRepository.listAfter(sessionId, afterSeq);

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
    await this.sessionRepository.completeRun(sessionId, runId);
    await this.sessionRepository.clearSteerIntent(sessionId);
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

    const writeDoneAndClose = () => {
      if (closed) return;
      res.write('data: [DONE]\n\n');
      res.end();
      close();
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

    const replayRows = await this.sessionEventRepository.listAfter(sessionId, lastSeq);
    for (const row of replayRows) {
      lastSeq = row.seq;
      const chunk = this.decorateStreamChunk(row.chunk, {
        seq: row.seq,
        runId: row.runId,
        generationId: row.generationId,
      });
      writeChunk(chunk);
      if (this.shouldCloseStream(chunk)) {
        writeDoneAndClose();
        return;
      }
    }

    if (!this.chatStreamService.isAvailable()) {
      await this.streamWithPollingFallback(
        sessionId,
        res,
        lastSeq,
        writeChunk,
        writeDoneAndClose,
        close,
      );
      return;
    }

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

          if (this.shouldCloseStream(chunk)) {
            clearInterval(heartbeat);
            subscription.unsubscribe();
            writeDoneAndClose();
            resolve();
          }
        },
        onComplete: () => {
          clearInterval(heartbeat);
          writeDoneAndClose();
          resolve();
        },
        onError: (error) => {
          this.logger.error(`Chat stream subscription error for ${sessionId}`, error);
          clearInterval(heartbeat);
          if (!closed) {
            writeChunk({ type: 'error', errorText: String(error) });
            writeDoneAndClose();
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
    writeDoneAndClose: () => void,
    close: () => void,
  ): Promise<void> {
    let lastSeq = initialSeq;

    await new Promise<void>((resolve) => {
      const poll = setInterval(async () => {
        try {
          const rows = await this.sessionEventRepository.listAfter(sessionId, lastSeq);
          for (const row of rows) {
            lastSeq = row.seq;
            const chunk = this.decorateStreamChunk(row.chunk, {
              seq: row.seq,
              runId: row.runId,
              generationId: row.generationId,
            });
            writeChunk(chunk);
            if (this.shouldCloseStream(chunk)) {
              clearInterval(poll);
              writeDoneAndClose();
              resolve();
              return;
            }
          }
        } catch (error) {
          this.logger.error(`Polling stream fallback failed for ${sessionId}`, error);
        }
      }, 250);

      res.on('close', () => {
        clearInterval(poll);
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

  private shouldCloseStream(chunk: Record<string, unknown>): boolean {
    if (chunk.type === 'finish') {
      return true;
    }

    if (chunk.type !== 'data-turn-status') {
      return false;
    }

    const rawData =
      chunk.data && typeof chunk.data === 'object' ? (chunk.data as Record<string, unknown>) : null;
    const status = typeof rawData?.status === 'string' ? rawData.status : null;
    return (
      status === 'completed' ||
      status === 'interrupted' ||
      status === 'failed' ||
      status === 'cancelled'
    );
  }

  private async applyTurnStatusFromChunk(
    sessionId: string,
    turnId: string,
    chunk: Record<string, unknown>,
    runId?: string,
    generationId?: string,
  ): Promise<void> {
    const status = this.extractTurnStatus(chunk);

    if (status === 'running') {
      await this.turnRepository.setTurnRunning(sessionId, turnId, runId, generationId);
      await this.sessionRepository.setProcessingStatus(sessionId, 'processing');
      return;
    }

    if (status) {
      await this.turnRepository.setTurnStatus(sessionId, turnId, status);
      const [runningTurn, queuedTurns] = await Promise.all([
        this.turnRepository.getRunningTurn(sessionId),
        this.turnRepository.listQueuedTurns(sessionId),
      ]);

      if (runningTurn || queuedTurns.length > 0) {
        await this.sessionRepository.setProcessingStatus(sessionId, 'processing');
      } else {
        await this.sessionRepository.setProcessingStatus(sessionId, 'idle');
        await this.sessionRepository.completeRun(sessionId, runId);
      }

      await this.sessionRepository.clearSteerIntent(sessionId);
    }
  }

  private extractTurnStatus(chunk: Record<string, unknown>): ChatTurnStatus | null {
    const directStatus = typeof chunk.status === 'string' ? chunk.status : null;
    const typeStatus = typeof chunk.type === 'string' ? chunk.type : null;
    const dataStatus =
      typeStatus === 'data-turn-status' &&
      chunk.data &&
      typeof chunk.data === 'object' &&
      typeof (chunk.data as Record<string, unknown>).status === 'string'
        ? ((chunk.data as Record<string, unknown>).status as string)
        : null;
    const candidate = dataStatus ?? directStatus ?? typeStatus;

    if (!candidate) {
      return null;
    }

    if (
      candidate === 'queued' ||
      candidate === 'running' ||
      candidate === 'completed' ||
      candidate === 'interrupted' ||
      candidate === 'failed' ||
      candidate === 'cancelled'
    ) {
      return candidate;
    }

    if (candidate === 'idle' || candidate === 'done') {
      return 'completed';
    }

    return null;
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
