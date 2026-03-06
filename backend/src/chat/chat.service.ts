import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { UIMessage } from 'ai';

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

const STREAM_REPLAY_BATCH_SIZE = 500;

type VNextOp = 'UserTurn' | 'Interrupt' | 'SteerNow';

export interface ThreadHistoryMessage {
  id: string;
  role: UIMessage['role'];
  parts: UIMessage['parts'];
  createdAt?: Date;
}

interface ThreadHistoryState {
  messages: ThreadHistoryMessage[];
  interruptionBoundaries: { turnId: string; beforeMessageIndex: number }[];
  queue: {
    turnId: string;
    queuePosition: number;
    status: string;
    preview?: string | null;
    queuedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  }[];
  processingStatus: 'idle' | 'processing' | 'stopping';
  activeTurn: { turnId: string; status: string; generationId: number | null } | null;
  activeGenerationId: number;
}

function appendTextDelta(parts: UIMessage['parts'], delta: string): UIMessage['parts'] {
  const next = [...parts];
  const last = next[next.length - 1] as Record<string, unknown> | undefined;
  if (last && last.type === 'text' && typeof last.text === 'string') {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` } as UIMessage['parts'][number];
    return next;
  }
  return [...next, { type: 'text', text: delta } as UIMessage['parts'][number]];
}

function upsertToolPart(
  parts: UIMessage['parts'],
  update: {
    toolCallId: string;
    toolName?: string;
    state: 'input-available' | 'output-available' | 'output-error';
    input?: unknown;
    output?: unknown;
    preliminary?: boolean;
    errorText?: string;
  },
): UIMessage['parts'] {
  const next = [...parts];
  const idx = next.findIndex((part) => {
    const typed = part as Record<string, unknown>;
    return typed?.type === 'tool-invocation' && typed?.toolCallId === update.toolCallId;
  });
  const base: Record<string, unknown> =
    idx >= 0 ? { ...(next[idx] as Record<string, unknown>) } : { type: 'tool-invocation' };
  const merged: Record<string, unknown> = {
    ...base,
    type: 'tool-invocation',
    toolCallId: update.toolCallId,
    ...(update.toolName ? { toolName: update.toolName } : {}),
    state: update.state,
    ...(update.input !== undefined ? { input: update.input } : {}),
    ...(update.output !== undefined ? { output: update.output } : {}),
    ...(update.preliminary !== undefined ? { preliminary: update.preliminary } : {}),
    ...(update.errorText ? { errorText: update.errorText } : {}),
  };
  if (idx >= 0) {
    next[idx] = merged as UIMessage['parts'][number];
    return next;
  }
  return [...next, merged as UIMessage['parts'][number]];
}

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

  async submitOperation(
    sessionId: string,
    input: {
      op: VNextOp;
      text?: string;
      clientSubmissionId: string;
      clientTurnHint?: string;
    },
    auth: AuthContext,
  ) {
    await this.assertSessionAccess(sessionId, auth);

    if (input.op === 'Interrupt') {
      const interrupted = await this.interruptGeneration(sessionId, auth);
      const lastSeq = await this.sessionEventRepository.getLastSeq(sessionId);
      return {
        submissionId: input.clientSubmissionId,
        operation: input.op,
        interruptedTurnId: interrupted.interruptedTurnId ?? null,
        acceptedAtSeq: lastSeq,
      };
    }

    const text = input.text?.trim();
    if (!text) {
      throw new BadRequestException('text is required for UserTurn/SteerNow');
    }

    const session = await this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });

    const shouldBumpGeneration =
      session.processingStatus === 'idle' ||
      session.activeRunId == null ||
      session.activeTurnId == null;
    const generationId = shouldBumpGeneration
      ? await this.sessionRepository.bumpGeneration(sessionId)
      : Number(session.activeGenerationId ?? 0);

    const queued = await this.turnRepository.enqueueTurnWithUserMessage({
      sessionId,
      message: text,
      clientMessageId: input.clientSubmissionId,
    });

    const runningTurn = await this.turnRepository.getRunningTurn(sessionId);
    const hasLiveRun =
      Boolean(runningTurn) ||
      session.processingStatus === 'processing' ||
      session.activeRunId != null;
    let runId = hasLiveRun ? (runningTurn?.runId ?? session.activeRunId ?? null) : null;

    if (!runId) {
      runId = randomUUID();
      await this.sessionRepository.startRun(sessionId, runId);
    }

    await this.temporalService.signalChatWorkflow(
      sessionId,
      {
        id: input.clientSubmissionId,
        role: 'user',
        parts: [{ type: 'text', text }],
      },
      runId,
      {
        turnId: queued.turn.id,
        queuedAt: queued.turn.queuedAt.toISOString(),
        generationId,
        submissionId: input.clientSubmissionId,
      },
    );

    await this.appendInternalEvent(sessionId, {
      turnId: queued.turn.id,
      runId,
      generationId,
      eventId: `${input.clientSubmissionId}:TurnQueued`,
      chunk: {
        type: 'data-turn-status',
        data: {
          turnId: queued.turn.id,
          status: 'queued',
          op: input.op,
          submissionId: input.clientSubmissionId,
          clientSubmissionId: input.clientSubmissionId,
          queuedAt: queued.turn.queuedAt.toISOString(),
          preview: queued.turn.userMessage,
          text,
          generationId,
        },
      },
    });

    await this.sessionRepository.setActiveTurn(sessionId, {
      turnId: runningTurn?.id ?? null,
      generationId,
      processingStatus: 'processing',
    });

    const acceptedAtSeq = await this.sessionEventRepository.getLastSeq(sessionId);
    return {
      submissionId: input.clientSubmissionId,
      operation: input.op,
      turnId: queued.turn.id,
      generationId,
      acceptedAtSeq,
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

  async getThreadHistory(sessionId: string, auth: AuthContext) {
    const session = await this.assertSessionAccess(sessionId, auth);
    const [rows, lastSeq] = await Promise.all([
      this.sessionEventRepository.listAfter(sessionId, 0, 100000),
      this.sessionEventRepository.getLastSeq(sessionId),
    ]);
    const projected = this.projectThreadHistory(rows);

    return {
      messages: projected.messages,
      interruptionBoundaries: projected.interruptionBoundaries,
      activeTurn: projected.activeTurn,
      generationId: projected.activeGenerationId,
      activeGeneration: projected.activeGenerationId,
      pendingCount: projected.queue.length,
      queue: projected.queue,
      queuedTurns: projected.queue,
      queueOrder: projected.queue.map((turn) => turn.turnId),
      processingStatus:
        projected.processingStatus === 'idle'
          ? session.processingStatus === 'stopping'
            ? 'stopping'
            : 'idle'
          : projected.processingStatus,
      afterSeq: lastSeq,
      lastSeq,
    };
  }

  private projectThreadHistory(
    rows: {
      seq: number;
      turnId: string;
      runId: string | null;
      generationId: string | null;
      eventId: string;
      chunk: Record<string, unknown>;
    }[],
  ): ThreadHistoryState {
    const messages: ThreadHistoryMessage[] = [];
    const interruptionBoundaries: { turnId: string; beforeMessageIndex: number }[] = [];
    const assistantMsgIndexByTurn = new Map<string, number>();
    const queueByTurn = new Map<
      string,
      {
        turnId: string;
        queuePosition: number;
        status: string;
        preview?: string | null;
        queuedAt?: string | null;
        startedAt?: string | null;
        completedAt?: string | null;
      }
    >();

    let activeTurn: { turnId: string; status: string; generationId: number | null } | null = null;
    let activeGenerationId = 0;

    const ensureAssistantMessage = (turnId: string): number => {
      const existing = assistantMsgIndexByTurn.get(turnId);
      if (existing != null) return existing;
      const idx = messages.length;
      messages.push({
        id: `turn-${turnId}`,
        role: 'assistant',
        parts: [],
      });
      assistantMsgIndexByTurn.set(turnId, idx);
      return idx;
    };

    const parseGeneration = (value: unknown): number | null => {
      if (value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    for (const row of rows) {
      const chunk = row.chunk ?? {};
      const type = typeof chunk.type === 'string' ? chunk.type : null;
      const data =
        chunk.data && typeof chunk.data === 'object' ? (chunk.data as Record<string, unknown>) : {};
      const generation =
        parseGeneration(row.generationId) ??
        parseGeneration(data.generationId) ??
        activeGenerationId;
      activeGenerationId = Math.max(activeGenerationId, generation ?? 0);

      if (type === 'data-turn-status') {
        const status = typeof data.status === 'string' ? data.status : null;
        const preview = typeof data.preview === 'string' ? data.preview : null;
        const queuedAt = typeof data.queuedAt === 'string' ? data.queuedAt : null;
        const startedAt = typeof data.startedAt === 'string' ? data.startedAt : null;
        const endedAt = typeof data.endedAt === 'string' ? data.endedAt : null;
        const text = typeof data.text === 'string' ? data.text : null;

        if (status === 'queued') {
          if (text) {
            messages.push({
              id: `user-${row.turnId}`,
              role: 'user',
              parts: [{ type: 'text', text }],
            });
          }
          queueByTurn.set(row.turnId, {
            turnId: row.turnId,
            queuePosition: queueByTurn.size + 1,
            status,
            preview,
            queuedAt,
            startedAt,
            completedAt: endedAt,
          });
        } else {
          const existing = queueByTurn.get(row.turnId);
          if (existing) {
            existing.status = status ?? existing.status;
            existing.startedAt = startedAt ?? existing.startedAt;
            existing.completedAt = endedAt ?? existing.completedAt;
            if (status && status !== 'queued') {
              queueByTurn.delete(row.turnId);
            }
          }
        }

        if (status === 'running') {
          activeTurn = { turnId: row.turnId, status, generationId: generation };
        }

        if (status === 'interrupted') {
          interruptionBoundaries.push({ turnId: row.turnId, beforeMessageIndex: messages.length });
          if (activeTurn?.turnId === row.turnId) {
            activeTurn = null;
          }
        }

        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          if (activeTurn?.turnId === row.turnId) {
            activeTurn = null;
          }
        }

        continue;
      }

      if (type === 'text-delta') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
        if (!delta) continue;
        const idx = ensureAssistantMessage(row.turnId);
        const message = messages[idx];
        messages[idx] = { ...message, parts: appendTextDelta(message.parts, delta) };
        continue;
      }

      if (
        type === 'tool-input-start' ||
        type === 'tool-input-available' ||
        type === 'tool-output-available' ||
        type === 'tool-output-error'
      ) {
        const toolCallId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : null;
        if (!toolCallId) continue;
        const toolName = typeof chunk.toolName === 'string' ? chunk.toolName : undefined;
        const idx = ensureAssistantMessage(row.turnId);
        const message = messages[idx];
        const update =
          type === 'tool-input-start'
            ? { toolCallId, toolName, state: 'input-available' as const }
            : type === 'tool-input-available'
              ? { toolCallId, toolName, state: 'input-available' as const, input: chunk.input }
              : type === 'tool-output-available'
                ? {
                    toolCallId,
                    toolName,
                    state: 'output-available' as const,
                    output: chunk.output,
                    preliminary: chunk.preliminary === true,
                  }
                : {
                    toolCallId,
                    toolName,
                    state: 'output-error' as const,
                    output: chunk.output,
                    errorText: typeof chunk.errorText === 'string' ? chunk.errorText : undefined,
                  };
        messages[idx] = { ...message, parts: upsertToolPart(message.parts, update) };
      }
    }

    const queue = [...queueByTurn.values()].map((entry, index) => ({
      ...entry,
      queuePosition: index + 1,
    }));
    const processingStatus: ThreadHistoryState['processingStatus'] =
      activeTurn || queue.length > 0 ? 'processing' : 'idle';

    return {
      messages,
      interruptionBoundaries,
      queue,
      processingStatus,
      activeTurn,
      activeGenerationId,
    };
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

  async getEvents(sessionId: string, afterSeq: number, auth: AuthContext) {
    return this.getRunEvents(sessionId, undefined, afterSeq, auth);
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

      await this.turnDraftRepository.delete(activeTurn.id).catch((err) => {
        this.logger.warn(`Failed to clear turn draft for turn ${activeTurn.id}: ${err}`);
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
    const session = await this.sessionRepository.getSessionInternal(sessionId);
    const turn = await this.turnRepository.getTurn(sessionId, input.turnId);
    const generationId =
      input.generationId === undefined || input.generationId === null
        ? undefined
        : String(input.generationId);
    const incomingGeneration =
      generationId != null && Number.isFinite(Number(generationId)) ? Number(generationId) : null;
    const activeGeneration = Number(session.activeGenerationId ?? 0);
    if (incomingGeneration != null && incomingGeneration < activeGeneration) {
      throw new ConflictException(
        `stale generation event rejected (incoming=${incomingGeneration}, active=${activeGeneration})`,
      );
    }
    if (
      session.activeTurnId &&
      session.activeTurnId !== turn.id &&
      incomingGeneration === activeGeneration
    ) {
      // Hard fence for late emits from previous turns within the active generation.
      const typedChunk = input.chunk as { type?: string };
      if (typedChunk.type && typedChunk.type !== 'data-turn-status') {
        throw new ConflictException(
          `stale turn event rejected (incoming=${turn.id}, active=${session.activeTurnId})`,
        );
      }
    }

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
    while (true) {
      const replayRows = await this.sessionEventRepository.listAfter(
        sessionId,
        lastSeq,
        STREAM_REPLAY_BATCH_SIZE,
      );
      if (replayRows.length === 0) {
        break;
      }

      for (const row of replayRows) {
        lastSeq = row.seq;
        const chunk = this.decorateStreamChunk(row.chunk, {
          seq: row.seq,
          runId: row.runId,
          generationId: row.generationId,
          turnId: row.turnId,
        });
        writeChunk(chunk);
      }

      if (replayRows.length < STREAM_REPLAY_BATCH_SIZE) {
        break;
      }
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
            turnId: typeof event.turnId === 'string' ? event.turnId : undefined,
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
    let pollInFlight = false;

    await new Promise<void>((resolve) => {
      const heartbeat = setInterval(() => {
        if (!res.closed) {
          res.write(': ping\n\n');
        }
      }, 15000);

      const poll = setInterval(() => {
        if (pollInFlight || res.closed) {
          return;
        }

        pollInFlight = true;
        void (async () => {
          try {
            const rows = await this.sessionEventRepository.listAfter(
              sessionId,
              lastSeq,
              STREAM_REPLAY_BATCH_SIZE,
            );
            for (const row of rows) {
              lastSeq = row.seq;
              const chunk = this.decorateStreamChunk(row.chunk, {
                seq: row.seq,
                runId: row.runId,
                generationId: row.generationId,
                turnId: row.turnId,
              });
              writeChunk(chunk);
            }
          } catch (error) {
            this.logger.error(`Polling stream fallback failed for ${sessionId}`, error);
          } finally {
            pollInFlight = false;
          }
        })();
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
    metadata: {
      seq?: number;
      runId?: string | null;
      generationId?: string | null;
      turnId?: string | null;
    },
  ): Record<string, unknown> {
    const baseChunk: Record<string, unknown> = {
      ...chunk,
      ...(metadata.seq != null ? { seq: metadata.seq } : {}),
      ...(metadata.runId ? { runId: metadata.runId } : {}),
      ...(metadata.generationId ? { generationId: metadata.generationId } : {}),
      ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
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

  private async assertSessionAccess(sessionId: string, auth: AuthContext) {
    return this.sessionRepository.getSession(sessionId, {
      userId: auth.userId ?? 'anonymous',
      organizationId: auth.organizationId,
    });
  }
}
