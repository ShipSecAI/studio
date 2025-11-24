import { describe, it, expect, vi } from 'bun:test';
import { TerminalArchiveService } from '../terminal-archive.service';

const chunks = [
  {
    chunkIndex: 1,
    payload: Buffer.from('hello').toString('base64'),
    recordedAt: '2025-01-01T00:00:00Z',
    deltaMs: 0,
    stream: 'pty',
  },
];

describe('TerminalArchiveService', () => {
  const terminalStream = {
    fetchChunks: vi.fn().mockResolvedValue({ chunks }),
    listStreams: vi.fn().mockResolvedValue([]),
    deleteStreams: vi.fn().mockResolvedValue(0),
  } as any;
  const filesService = {
    uploadFile: vi.fn().mockResolvedValue({ id: 'file-1', fileName: 'a.cast', mimeType: 'application/x-asciinema', size: 10 }),
    downloadFile: vi.fn(),
  } as any;
  const repo = {
    create: vi.fn().mockResolvedValue({
      id: 1,
      runId: 'run-1',
      nodeRef: 'node',
      stream: 'pty',
      fileId: 'file-1',
      chunkCount: 1,
      durationMs: 0,
      createdAt: new Date(),
    }),
    listByRun: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  } as any;
  const workflowsService = {
    resolveRunForAccess: vi.fn().mockResolvedValue({
      run: { workflowId: 'wf-1', workflowVersionId: 'ver-1' },
      organizationId: 'org-1',
    }),
    resolveRunWithoutAuth: vi.fn().mockResolvedValue({
      run: { workflowId: 'wf-1', workflowVersionId: 'ver-1' },
      organizationId: 'org-1',
    }),
  } as any;

  it('archives terminal chunks and stores metadata', async () => {
    const service = new TerminalArchiveService(
      terminalStream,
      filesService,
      repo,
      workflowsService,
    );

    const record = await service.archive(null, 'run-1', { nodeRef: 'node' } as any);

    expect(terminalStream.fetchChunks).toHaveBeenCalledWith('run-1', {
      nodeRef: 'node',
      stream: 'pty',
    });
    expect(filesService.uploadFile).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(record.runId).toBe('run-1');
  });

  it('replays archived cast data', async () => {
    const castContent = [
      '{"version":2,"width":80,"height":24}',
      '[0.0,"o","Hello "]',
      '[0.5,"o","World"]',
    ].join('\n');
    repo.listByRun.mockResolvedValueOnce([
      {
        id: 10,
        runId: 'run-1',
        nodeRef: 'node',
        stream: 'pty',
        fileId: 'file-1',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        firstChunkIndex: 1,
      },
    ]);
    filesService.downloadFile.mockResolvedValueOnce({ buffer: Buffer.from(castContent) });

    const service = new TerminalArchiveService(
      terminalStream,
      filesService,
      repo,
      workflowsService,
    );

    const result = await service.replay({ organizationId: 'org-1' } as any, 'run-1', {
      nodeRef: 'node',
      stream: 'pty',
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.cursor).toContain('archive');
    expect(result.chunks[0].payload).toBe(Buffer.from('Hello ').toString('base64'));
  });
});
