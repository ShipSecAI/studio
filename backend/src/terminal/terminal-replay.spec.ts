
import { Test, TestingModule } from '@nestjs/testing';
import { TerminalStreamService, TERMINAL_REDIS } from '../backend/src/terminal/terminal-stream.service';
import { TerminalRecordRepository } from '../backend/src/workflows/repository/terminal-record.repository';
import { FilesService } from '../backend/src/storage/files.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TerminalStreamService Replay', () => {
  let service: TerminalStreamService;
  let recordRepo: any;
  let filesService: any;

  beforeEach(async () => {
    recordRepo = {
      listByRun: vi.fn(),
    };
    filesService = {
      downloadFile: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TerminalStreamService,
        { provide: TERMINAL_REDIS, useValue: null }, // Simulate no Redis
        { provide: TerminalRecordRepository, useValue: recordRepo },
        { provide: FilesService, useValue: filesService },
      ],
    }).compile();

    service = module.get<TerminalStreamService>(TerminalStreamService);
  });

  it('should fetch chunks from archive when Redis is empty', async () => {
    const runId = 'test-run-1';
    const nodeRef = 'test-node';
    const fileId = 'file-123';
    
    // Mock archived record
    recordRepo.listByRun.mockResolvedValue([
      {
        runId,
        nodeRef,
        stream: 'pty',
        fileId,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
    ]);

    // Mock file content (asciinema cast v2)
    const castContent = [
      '{"version": 2, "width": 80, "height": 24}',
      '[0.1, "o", "Hello "]',
      '[0.2, "o", "World\\n"]',
    ].join('\n');

    filesService.downloadFile.mockResolvedValue({
      buffer: Buffer.from(castContent),
    });

    const result = await service.fetchChunks(runId, { nodeRef });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].payload).toBe(Buffer.from('Hello ').toString('base64'));
    expect(result.chunks[1].payload).toBe(Buffer.from('World\n').toString('base64'));
    expect(result.chunks[0].origin).toBe('archive');
  });
});
