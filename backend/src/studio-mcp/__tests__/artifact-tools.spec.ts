import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpService } from '../studio-mcp.service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import type { WorkflowsService } from '../../workflows/workflows.service';

type RegisteredToolsMap = Record<string, any>;

function getRegisteredTools(server: McpServer): RegisteredToolsMap {
  return (server as unknown as { _registeredTools: RegisteredToolsMap })._registeredTools;
}

const mockAuth: AuthContext = {
  userId: 'test-user-id',
  organizationId: 'test-org-id',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const sampleArtifact = {
  id: 'a1',
  name: 'report.txt',
  size: 1024,
  mimeType: 'text/plain',
  runId: 'run-1',
  createdAt: '2026-01-01',
};

function makeWorkflowsService(): WorkflowsService {
  return {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    updateMetadata: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    listRuns: jest.fn().mockResolvedValue({ runs: [] }),
    getRunStatus: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
    getRunResult: jest.fn().mockResolvedValue({}),
    cancelRun: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowsService;
}

function makeArtifactsService() {
  return {
    listArtifacts: jest.fn().mockResolvedValue({ artifacts: [sampleArtifact] }),
    listRunArtifacts: jest.fn().mockResolvedValue({ artifacts: [sampleArtifact] }),
    downloadArtifact: jest.fn().mockResolvedValue({
      buffer: Buffer.from('hello world content here'),
      artifact: { id: 'a1', name: 'test.txt', mimeType: 'text/plain' },
    }),
    deleteArtifact: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Artifact Tools', () => {
  let workflowsService: WorkflowsService;
  let artifactsService: ReturnType<typeof makeArtifactsService>;
  let service: StudioMcpService;

  beforeEach(() => {
    workflowsService = makeWorkflowsService();
    artifactsService = makeArtifactsService();
    service = new StudioMcpService(workflowsService, artifactsService as any);
  });

  // ─── list_artifacts ──────────────────────────────────────────────────────────

  describe('list_artifacts', () => {
    it('calls artifactsService.listArtifacts with auth and filters', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      await tools['list_artifacts'].handler({
        workflowId: 'wf-123',
        search: 'report',
        limit: 10,
      });

      expect(artifactsService.listArtifacts).toHaveBeenCalledWith(mockAuth, {
        workflowId: 'wf-123',
        search: 'report',
        limit: 10,
      });
    });

    it('uses default limit of 20 when limit is not provided', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      await tools['list_artifacts'].handler({});

      expect(artifactsService.listArtifacts).toHaveBeenCalledWith(mockAuth, {
        workflowId: undefined,
        search: undefined,
        limit: 20,
      });
    });

    it('returns normalized summary with expected fields', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        id: 'a1',
        name: 'report.txt',
        size: 1024,
        mimeType: 'text/plain',
        runId: 'run-1',
        createdAt: '2026-01-01',
      });
    });

    it('normalizes when service returns a plain array', async () => {
      artifactsService.listArtifacts.mockResolvedValue([sampleArtifact]);

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('a1');
    });

    it('normalizes contentType → mimeType when mimeType is absent', async () => {
      artifactsService.listArtifacts.mockResolvedValue({
        artifacts: [
          {
            id: 'b1',
            name: 'data.bin',
            size: 512,
            contentType: 'application/octet-stream',
            runId: 'run-2',
            createdAt: '2026-01-02',
          },
        ],
      });

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed[0].mimeType).toBe('application/octet-stream');
    });

    it('returns error result when artifactsService throws', async () => {
      artifactsService.listArtifacts.mockRejectedValue(new Error('DB connection failed'));

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('DB connection failed');
    });
  });

  // ─── list_run_artifacts ──────────────────────────────────────────────────────

  describe('list_run_artifacts', () => {
    it('calls artifactsService.listRunArtifacts with auth and runId', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      await tools['list_run_artifacts'].handler({ runId: 'run-42' });

      expect(artifactsService.listRunArtifacts).toHaveBeenCalledWith(mockAuth, 'run-42');
    });

    it('returns normalized artifact summary', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_run_artifacts'].handler({ runId: 'run-1' });
      const parsed = JSON.parse(result.content[0].text);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toMatchObject({
        id: 'a1',
        name: 'report.txt',
        runId: 'run-1',
      });
    });

    it('normalizes when service returns a plain array', async () => {
      artifactsService.listRunArtifacts.mockResolvedValue([sampleArtifact]);

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_run_artifacts'].handler({ runId: 'run-1' });
      const parsed = JSON.parse(result.content[0].text);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('a1');
    });

    it('returns error result when artifactsService throws', async () => {
      artifactsService.listRunArtifacts.mockRejectedValue(new Error('not found'));

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_run_artifacts'].handler({ runId: 'run-99' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  // ─── view_artifact ───────────────────────────────────────────────────────────

  describe('view_artifact', () => {
    it('returns text content for text/plain files', async () => {
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({ artifactId: 'a1' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.isText).toBe(true);
      expect(parsed.content).toBe('hello world content here');
      expect(parsed.id).toBe('a1');
      expect(parsed.name).toBe('test.txt');
      expect(parsed.mimeType).toBe('text/plain');
      expect(parsed.totalSize).toBe(24); // Buffer.from('hello world content here').length
    });

    it('returns metadata-only for binary files', async () => {
      artifactsService.downloadArtifact.mockResolvedValue({
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
        artifact: { id: 'a2', name: 'image.png', mimeType: 'image/png' },
      });

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({ artifactId: 'a2' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.isText).toBe(false);
      expect(parsed.id).toBe('a2');
      expect(parsed.name).toBe('image.png');
      expect(parsed.mimeType).toBe('image/png');
      expect(parsed.totalSize).toBe(4);
      expect(parsed.message).toContain('Binary file');
      expect(parsed.content).toBeUndefined();
    });

    it('windowing: offset=5, limit=5 returns correct slice', async () => {
      // 'hello world content here' → bytes 5..9 → ' worl'
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({
        artifactId: 'a1',
        offset: 5,
        limit: 5,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.isText).toBe(true);
      expect(parsed.offset).toBe(5);
      expect(parsed.limit).toBe(5);
      expect(parsed.content).toBe(' worl');
    });

    it('hasMore is true when there is remaining content', async () => {
      // totalSize=24, offset=0, limit=10 → 0+10=10 < 24 → hasMore=true
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({
        artifactId: 'a1',
        offset: 0,
        limit: 10,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.hasMore).toBe(true);
    });

    it('hasMore is false when offset+limit covers remaining content', async () => {
      // totalSize=24, offset=20, limit=10 → 20+10=30 >= 24 → hasMore=false
      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({
        artifactId: 'a1',
        offset: 20,
        limit: 10,
      });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.hasMore).toBe(false);
    });

    it('returns error result when artifactsService throws', async () => {
      artifactsService.downloadArtifact.mockRejectedValue(new Error('artifact not found'));

      const server = service.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({ artifactId: 'missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('artifact not found');
    });
  });

  // ─── Service unavailable ─────────────────────────────────────────────────────

  describe('when artifactsService is unavailable', () => {
    let serviceWithoutArtifacts: StudioMcpService;

    beforeEach(() => {
      serviceWithoutArtifacts = new StudioMcpService(workflowsService);
    });

    it('list_artifacts returns error when service is not injected', async () => {
      const server = serviceWithoutArtifacts.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Artifacts service is not available');
    });

    it('list_run_artifacts returns error when service is not injected', async () => {
      const server = serviceWithoutArtifacts.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_run_artifacts'].handler({ runId: 'run-1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Artifacts service is not available');
    });

    it('view_artifact returns error when service is not injected', async () => {
      const server = serviceWithoutArtifacts.createServer(mockAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({ artifactId: 'a1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Artifacts service is not available');
    });
  });

  // ─── Permission gating ───────────────────────────────────────────────────────

  describe('permission gating', () => {
    const deniedAuth: AuthContext = {
      userId: 'api-key-user',
      organizationId: 'test-org-id',
      roles: ['MEMBER'],
      isAuthenticated: true,
      provider: 'api-key',
      apiKeyPermissions: {
        workflows: { run: true, list: true, read: true },
        runs: { read: true, cancel: false },
        audit: { read: false },
        artifacts: { read: false },
      },
    };

    it('list_artifacts returns permission denied when artifacts.read is false', async () => {
      const server = service.createServer(deniedAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_artifacts'].handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('artifacts.read');
    });

    it('list_run_artifacts returns permission denied when artifacts.read is false', async () => {
      const server = service.createServer(deniedAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['list_run_artifacts'].handler({ runId: 'run-1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('artifacts.read');
    });

    it('view_artifact returns permission denied when artifacts.read is false', async () => {
      const server = service.createServer(deniedAuth);
      const tools = getRegisteredTools(server);

      const result = await tools['view_artifact'].handler({ artifactId: 'a1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('artifacts.read');
    });

    it('all artifact tools are allowed when no apiKeyPermissions (non-API-key auth)', async () => {
      const server = service.createServer(mockAuth); // no apiKeyPermissions
      const tools = getRegisteredTools(server);

      const r1 = await tools['list_artifacts'].handler({});
      expect(r1.isError).toBeUndefined();

      const r2 = await tools['list_run_artifacts'].handler({ runId: 'run-1' });
      expect(r2.isError).toBeUndefined();

      const r3 = await tools['view_artifact'].handler({ artifactId: 'a1' });
      expect(r3.isError).toBeUndefined();
    });

    it('all artifact tools are allowed when artifacts.read is true', async () => {
      const allowedAuth: AuthContext = {
        ...deniedAuth,
        apiKeyPermissions: {
          workflows: { run: false, list: false, read: false },
          runs: { read: false, cancel: false },
          audit: { read: false },
          artifacts: { read: true },
        },
      };

      const server = service.createServer(allowedAuth);
      const tools = getRegisteredTools(server);

      const r1 = await tools['list_artifacts'].handler({});
      expect(r1.isError).toBeUndefined();

      const r2 = await tools['list_run_artifacts'].handler({ runId: 'run-1' });
      expect(r2.isError).toBeUndefined();

      const r3 = await tools['view_artifact'].handler({ artifactId: 'a1' });
      expect(r3.isError).toBeUndefined();
    });
  });
});
