import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ROLES } from '../auth/types';
import { TerminalStreamService, type TerminalFetchResult, type TerminalChunk } from '../terminal/terminal-stream.service';
import { FilesService } from '../storage/files.service';
import { TerminalRecordRepository } from './repository/terminal-record.repository';
import type { WorkflowTerminalRecord } from '../database/schema';
import { WorkflowsService } from './workflows.service';
import { TerminalArchiveRequestDto } from './dto/terminal-record.dto';

@Injectable()
export class TerminalArchiveService {
  private readonly archivingRuns = new Set<string>();

  constructor(
    private readonly terminalStreamService: TerminalStreamService,
    private readonly filesService: FilesService,
    private readonly terminalRecordRepository: TerminalRecordRepository,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async archiveRun(auth: AuthContext | null, runId: string): Promise<WorkflowTerminalRecord[]> {
    if (this.archivingRuns.has(runId)) {
      return [];
    }

    this.archivingRuns.add(runId);
    try {
      const { run, organizationId } = await this.resolveRunContext(runId, auth);
      const existing = await this.terminalRecordRepository.listByRun(runId, organizationId);
      const archivedKeys = new Set(existing.map((record) => `${record.nodeRef}:${record.stream}`));
      const streams = await this.terminalStreamService.listStreams(runId);
      const results: WorkflowTerminalRecord[] = [];

      for (const { nodeRef, stream } of streams) {
        const dedupeKey = `${nodeRef}:${stream}`;
        if (archivedKeys.has(dedupeKey)) {
          continue;
        }
        const normalizedStream: 'stdout' | 'stderr' | 'pty' =
          stream === 'stdout' || stream === 'stderr' || stream === 'pty' ? stream : 'pty';
        try {
          const result = await this.archiveWithContext(
            auth,
            run,
            organizationId,
            runId,
            { nodeRef, stream: normalizedStream },
          );
          results.push(result);
          archivedKeys.add(dedupeKey);
        } catch (error) {
          console.warn(`Failed to archive terminal for ${runId}/${nodeRef}/${stream}`, error);
        }
      }
      if (results.length > 0) {
        await this.terminalStreamService.deleteStreams(runId).catch((error) => {
          console.warn(`Failed to delete Redis terminal streams for run ${runId}`, error);
        });
      }
      return results;
    } finally {
      this.archivingRuns.delete(runId);
    }
  }

  async list(auth: AuthContext | null, runId: string): Promise<WorkflowTerminalRecord[]> {
    const { organizationId } = await this.workflowsService.resolveRunForAccess(runId, auth);
    return this.terminalRecordRepository.listByRun(runId, organizationId);
  }

  async archive(
    auth: AuthContext | null,
    runId: string,
    input: TerminalArchiveRequestDto,
  ): Promise<WorkflowTerminalRecord> {
    const { run, organizationId } = await this.resolveRunContext(runId, auth);
    return this.archiveWithContext(auth, run, organizationId, runId, input);
  }

  async download(
    auth: AuthContext | null,
    runId: string,
    recordId: number,
  ) {
    const { organizationId } = await this.workflowsService.resolveRunForAccess(runId, auth);
    const record = await this.terminalRecordRepository.findById(recordId, {
      runId,
      organizationId,
    });
    if (!record) {
      throw new NotFoundException('Terminal recording not found');
    }

    const download = await this.filesService.downloadFile(auth, record.fileId);
    return { record, file: download.file, buffer: download.buffer };
  }

  async replay(
    auth: AuthContext | null,
    runId: string,
    input: { nodeRef: string; stream?: string; cursor?: string | null },
  ): Promise<TerminalFetchResult> {
    const { organizationId } = await this.workflowsService.resolveRunForAccess(runId, auth);
    const records = await this.terminalRecordRepository.listByRun(runId, organizationId);
    if (records.length === 0) {
      return { cursor: input.cursor ?? '{}', chunks: [] };
    }

    const stream = input.stream ?? 'pty';
    const matching = records.filter(
      (record) => record.nodeRef === input.nodeRef && record.stream === stream,
    );
    if (matching.length === 0) {
      return { cursor: input.cursor ?? '{}', chunks: [] };
    }

    const cursorState = this.parseArchiveCursor(input.cursor);
    const targetRecord =
      cursorState && matching.some((record) => record.id === cursorState.recordId)
        ? matching.find((record) => record.id === cursorState.recordId)
        : matching[0];
    if (!targetRecord) {
      return { cursor: input.cursor ?? '{}', chunks: [] };
    }

    const { buffer } = await this.filesService.downloadFile(
      this.buildSystemAuth(auth, organizationId),
      targetRecord.fileId,
    );
    const parsed = this.parseCastFile(buffer, targetRecord, {
      startOffset: cursorState?.offset ?? 0,
    });
    const nextCursor = this.serializeArchiveCursor(targetRecord.id, parsed.nextOffset);
    return { cursor: nextCursor, chunks: parsed.chunks };
  }

  private buildCastFile(
    chunks: Array<{ payload: string; deltaMs: number; stream: string; recordedAt?: string }>,
    options: { width: number; height: number },
  ): Buffer {
    // Use first chunk's recordedAt as workflow start time (Unix epoch seconds)
    // If no chunks or no recordedAt, fall back to current time
    const workflowStartTime = chunks.length > 0 && chunks[0].recordedAt
      ? Math.floor(new Date(chunks[0].recordedAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const header = {
      version: 2,
      width: options.width,
      height: options.height,
      timestamp: workflowStartTime,
    };

    const lines: string[] = [JSON.stringify(header)];
    let elapsed = 0;

    for (const chunk of chunks) {
      elapsed += chunk.deltaMs ?? 0;
      const timeSeconds = Number((elapsed / 1000).toFixed(6));
      const decoded = Buffer.from(chunk.payload, 'base64').toString('utf8');
      const streamSymbol = chunk.stream === 'stderr' ? 'e' : 'o';
      lines.push(JSON.stringify([timeSeconds, streamSymbol, decoded]));
    }

    return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  }

  private parseCastFile(
    buffer: Buffer,
    record: WorkflowTerminalRecord,
    options: { startOffset: number },
  ): { chunks: TerminalFetchResult['chunks']; nextOffset: number } {
    const content = buffer.toString('utf8').trim();
    if (!content) {
      return { chunks: [], nextOffset: options.startOffset };
    }
    const lines = content.split('\n');
    // Parse header to get workflow start timestamp
    const headerLine = lines.shift();
    if (!headerLine) {
      return { chunks: [], nextOffset: options.startOffset };
    }

    let workflowStartTime: number;
    try {
      const header = JSON.parse(headerLine) as { version: number; timestamp?: number; width?: number; height?: number };
      // Cast file timestamp is Unix epoch seconds, convert to milliseconds
      workflowStartTime = header.timestamp ? header.timestamp * 1000 : record.createdAt.getTime();
    } catch {
      // Fallback to record creation time if header parsing fails
      workflowStartTime = record.createdAt.getTime();
    }

    let chunkIndex = record.firstChunkIndex ?? 0;
    const offset = Math.max(0, options.startOffset);
    let currentOffset = 0;
    let previousTime = 0;
    const chunks: TerminalFetchResult['chunks'] = [];

    const recordStream: TerminalChunk['stream'] =
      record.stream === 'stdout' || record.stream === 'stderr' || record.stream === 'pty'
        ? (record.stream as TerminalChunk['stream'])
        : 'stdout';

    for (const raw of lines) {
      if (!raw.trim()) {
        continue;
      }
      try {
        const [timeSeconds, streamSymbol, text] = JSON.parse(raw) as [number, string, string];
        if (currentOffset++ < offset) {
          previousTime = timeSeconds;
          chunkIndex += 1;
          continue;
        }
        const deltaSeconds = timeSeconds - previousTime;
        previousTime = timeSeconds;
        
        // Reconstruct absolute timestamp: workflow start + elapsed time
        const elapsedMs = Math.round(timeSeconds * 1000);
        const absoluteTimestamp = workflowStartTime + elapsedMs;
        
        const resolvedStream: TerminalChunk['stream'] =
          streamSymbol === 'e' ? 'stderr' : recordStream;
        chunks.push({
          nodeRef: record.nodeRef,
          stream: resolvedStream,
          chunkIndex: chunkIndex++,
          payload: Buffer.from(text).toString('base64'),
          recordedAt: new Date(absoluteTimestamp).toISOString(),
          deltaMs: Math.max(0, Math.round(deltaSeconds * 1000)),
          origin: 'archive',
          runnerKind: 'docker',
        });
      } catch (error) {
        console.warn('Failed to parse cast payload', error);
      }
    }
    return { chunks, nextOffset: offset + chunks.length };
  }

  private parseArchiveCursor(cursor?: string | null): { recordId: number; offset: number } | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(cursor) as { archive?: { recordId: number; offset: number } };
      if (parsed?.archive && typeof parsed.archive.recordId === 'number') {
        return {
          recordId: parsed.archive.recordId,
          offset: parsed.archive.offset ?? 0,
        };
      }
    } catch {}
    return null;
  }

  private serializeArchiveCursor(recordId: number, offset: number): string {
    return JSON.stringify({ archive: { recordId, offset } });
  }

  private buildSystemAuth(auth: AuthContext | null, organizationId: string | null): AuthContext {
    if (auth?.organizationId) {
      return auth;
    }
    return {
      userId: null,
      organizationId,
      roles: DEFAULT_ROLES,
      isAuthenticated: false,
      provider: 'system',
    };
  }

  private async resolveRunContext(runId: string, auth: AuthContext | null) {
    if (auth?.organizationId) {
      return this.workflowsService.resolveRunForAccess(runId, auth);
    }
    return this.workflowsService.resolveRunWithoutAuth(runId);
  }

  private async archiveWithContext(
    auth: AuthContext | null,
    run: { workflowId: string; workflowVersionId?: string | null },
    organizationId: string | null,
    runId: string,
    input: TerminalArchiveRequestDto,
  ) {
    const { nodeRef, stream = 'pty', width = 120, height = 30 } = input;
    const terminal = await this.terminalStreamService.fetchChunks(runId, {
      nodeRef,
      stream,
    });

    if (terminal.chunks.length === 0) {
      throw new NotFoundException('No terminal chunks available for archival');
    }

    const normalizedChunks = this.normalizeChunkTimings(terminal.chunks);
    const castBuffer = this.buildCastFile(normalizedChunks, { width, height });
    const fileName = `terminal-${runId}-${nodeRef}-${Date.now()}.cast`;

    const file = await this.filesService.uploadFile(
      this.buildSystemAuth(auth, organizationId),
      fileName,
      castBuffer,
      'application/x-asciinema',
    );

    return this.terminalRecordRepository.create({
      runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      nodeRef,
      stream,
      fileId: file.id,
      chunkCount: normalizedChunks.length,
      durationMs: normalizedChunks.reduce((total, chunk) => total + (chunk.deltaMs ?? 0), 0),
      firstChunkIndex: normalizedChunks[0]?.chunkIndex ?? null,
      lastChunkIndex: normalizedChunks[normalizedChunks.length - 1]?.chunkIndex ?? null,
      organizationId,
      createdAt: new Date(),
    });
  }

  private normalizeChunkTimings<
    T extends { recordedAt?: string | null; deltaMs?: number }
  >(chunks: T[]): Array<T & { deltaMs: number }> {
    let previousRecordedAt: number | null = null;
    return chunks.map((chunk, index) => {
      const recordedAtMs =
        chunk.recordedAt && !Number.isNaN(Date.parse(chunk.recordedAt))
          ? new Date(chunk.recordedAt).getTime()
          : null;
      let deltaMs =
        typeof chunk.deltaMs === 'number' && Number.isFinite(chunk.deltaMs) ? chunk.deltaMs : 0;
      if (recordedAtMs !== null && previousRecordedAt !== null) {
        deltaMs = Math.max(0, recordedAtMs - previousRecordedAt);
      } else if (index === 0) {
        deltaMs = 0;
      }

      if (recordedAtMs !== null) {
        previousRecordedAt = recordedAtMs;
      } else if (previousRecordedAt !== null) {
        previousRecordedAt += deltaMs;
      }

      return { ...chunk, deltaMs };
    });
  }
}
