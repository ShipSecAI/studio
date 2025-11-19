import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { TerminalStreamService } from '../terminal/terminal-stream.service';
import { FilesService } from '../storage/files.service';
import { TerminalRecordRepository } from './repository/terminal-record.repository';
import type { WorkflowTerminalRecord } from '../database/schema';
import { WorkflowsService } from './workflows.service';
import { TerminalArchiveRequestDto } from './dto/terminal-record.dto';

@Injectable()
export class TerminalArchiveService {
  constructor(
    private readonly terminalStreamService: TerminalStreamService,
    private readonly filesService: FilesService,
    private readonly terminalRecordRepository: TerminalRecordRepository,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async archiveRun(auth: AuthContext | null, runId: string): Promise<WorkflowTerminalRecord[]> {
    const streams = await this.terminalStreamService.listStreams(runId);
    const results: WorkflowTerminalRecord[] = [];

    for (const { nodeRef, stream } of streams) {
      try {
        const result = await this.archive(auth, runId, { nodeRef, stream });
        results.push(result);
      } catch (error) {
        // Ignore if no chunks found or other error, continue to next
        console.warn(`Failed to archive terminal for ${runId}/${nodeRef}/${stream}`, error);
      }
    }
    return results;
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
    const { run, organizationId } = await this.workflowsService.resolveRunForAccess(runId, auth);
    const { nodeRef, stream = 'pty', width = 120, height = 30 } = input;

    const terminal = await this.terminalStreamService.fetchChunks(runId, {
      nodeRef,
      stream,
    });

    if (terminal.chunks.length === 0) {
      throw new NotFoundException('No terminal chunks available for archival');
    }

    const castBuffer = this.buildCastFile(terminal.chunks, { width, height });
    const fileName = `terminal-${runId}-${nodeRef}-${Date.now()}.cast`;

    const file = await this.filesService.uploadFile(auth, fileName, castBuffer, 'application/x-asciinema');

    return this.terminalRecordRepository.create({
      runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      nodeRef,
      stream,
      fileId: file.id,
      chunkCount: terminal.chunks.length,
      durationMs: terminal.chunks.reduce((total, chunk) => total + (chunk.deltaMs ?? 0), 0),
      firstChunkIndex: terminal.chunks[0]?.chunkIndex ?? null,
      lastChunkIndex: terminal.chunks[terminal.chunks.length - 1]?.chunkIndex ?? null,
      organizationId,
      createdAt: new Date(),
    });
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

  private buildCastFile(
    chunks: Array<{ payload: string; deltaMs: number; stream: string }>,
    options: { width: number; height: number },
  ): Buffer {
    const header = {
      version: 2,
      width: options.width,
      height: options.height,
      timestamp: Math.floor(Date.now() / 1000),
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
}
