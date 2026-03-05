import type { ChatTurnStatus } from './chat-turn.repository';
import type { ChatTurnRepository } from './chat-turn.repository';
import type { ChatSessionRepository } from './chat-session.repository';

/**
 * Extract a turn status from a raw stream chunk.
 * Handles multiple chunk shapes: direct `status` field, `data-turn-status` type
 * with nested `data.status`, and legacy `idle`/`done` mappings.
 */
export function extractTurnStatus(chunk: Record<string, unknown>): ChatTurnStatus | null {
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

/**
 * Apply turn status side-effects (update turn status, processing status, etc.)
 * Shared between ChatService.appendInternalEvent and ChatStreamIngestService.
 */
export async function applyTurnStatus(
  repos: {
    turnRepository: ChatTurnRepository;
    sessionRepository: ChatSessionRepository;
  },
  sessionId: string,
  turnId: string,
  chunk: Record<string, unknown>,
  runId?: string,
  generationId?: string,
): Promise<void> {
  const status = extractTurnStatus(chunk);

  if (status === 'running') {
    const runningUpdate = await repos.turnRepository.setTurnRunning(
      sessionId,
      turnId,
      runId,
      generationId,
    );
    if (runningUpdate?.promoted && runningUpdate.userMessage) {
      await repos.sessionRepository.saveMessage(sessionId, {
        role: 'user',
        parts: [{ type: 'text', text: runningUpdate.userMessage }],
      });
    }
    await repos.sessionRepository.setProcessingStatus(sessionId, 'processing');
    return;
  }

  if (status === 'queued') {
    await repos.sessionRepository.setProcessingStatus(sessionId, 'processing');
    return;
  }

  if (status) {
    await repos.turnRepository.setTurnStatus(sessionId, turnId, status);
    const [runningTurn, queuedTurns] = await Promise.all([
      repos.turnRepository.getRunningTurn(sessionId),
      repos.turnRepository.listQueuedTurns(sessionId),
    ]);

    if (runningTurn || queuedTurns.length > 0) {
      await repos.sessionRepository.setProcessingStatus(sessionId, 'processing');
    } else {
      await repos.sessionRepository.setProcessingStatus(sessionId, 'idle');
      await repos.sessionRepository.completeRun(sessionId, runId);
    }
    if (
      status === 'completed' ||
      status === 'interrupted' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      await repos.sessionRepository.clearSteerIntent(sessionId);
    }
  }
}
