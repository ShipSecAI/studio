import { describe, it, expect, beforeEach, jest, mock } from 'bun:test';
import { McpGroupsSeedingService } from '../mcp-groups-seeding.service';
import { McpGroupsRepository } from '../mcp-groups.repository';

// ---------------------------------------------------------------------------
// Minimal mock template registry (avoids loading real JSON fixtures)
// ---------------------------------------------------------------------------
const MOCK_TEMPLATE = {
  slug: 'test-group',
  name: 'Test Group',
  description: 'A test group',
  credentialContractName: 'test-cred',
  credentialMapping: null,
  defaultDockerImage: 'test-image:latest',
  version: { major: 1, minor: 0, patch: 0 },
  servers: [
    {
      name: 'test-server',
      description: 'A test server',
      transportType: 'http' as const,
      endpoint: 'http://localhost:8080',
      recommended: true,
      defaultSelected: true,
    },
  ],
};

mock.module('../mcp-group-templates', () => ({
  MCP_GROUP_TEMPLATES: { 'test-group': MOCK_TEMPLATE },
  computeTemplateHash: (_t: unknown) => 'mock-hash-abc',
}));

// ---------------------------------------------------------------------------
// DB / transaction helpers
// ---------------------------------------------------------------------------
function makeTx(insertedServerId = 'server-uuid-1', insertedGroupId = 'group-uuid-1') {
  const returning = jest.fn();
  const values = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
  // where() must be both awaitable (resolves to []) AND have .limit() for different call-sites
  const makeWhereResult = () => {
    const p = Promise.resolve([]) as any;
    p.limit = jest.fn().mockResolvedValue([]);
    return p;
  };
  const where = jest.fn().mockImplementation(makeWhereResult);
  const select = jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where }) });
  const insert = jest.fn().mockReturnValue({ values });
  const update = jest.fn().mockReturnValue({ set });
  const deleteFrom = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) });

  // Default returning sequences: first call → group, subsequent → server
  let callCount = 0;
  returning.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve([{ id: insertedGroupId, slug: 'test-group', templateHash: null }]);
    }
    return Promise.resolve([{ id: insertedServerId }]);
  });

  return { insert, select, update, delete: deleteFrom, returning, values };
}

function makeDb(tx: ReturnType<typeof makeTx>) {
  return {
    transaction: jest.fn().mockImplementation((fn: (tx: any) => Promise<any>) => fn(tx)),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
    ...tx,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('McpGroupsSeedingService – multi-tenant isolation', () => {
  let service: McpGroupsSeedingService;
  let groupsRepository: McpGroupsRepository;
  let tx: ReturnType<typeof makeTx>;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    tx = makeTx();
    db = makeDb(tx);

    groupsRepository = {
      findBySlug: jest.fn().mockResolvedValue(null), // group does not yet exist → create path
    } as unknown as McpGroupsRepository;

    service = new McpGroupsSeedingService(db as any, groupsRepository);
  });

  describe('syncTemplate – create path (group does not exist yet)', () => {
    it('stamps created servers with the provided organizationId', async () => {
      const orgId = 'org-abc-123';
      await service.syncTemplate('test-group', false, orgId);

      // Find the insert call for mcp_servers
      const insertCalls = tx.insert.mock.calls;
      // tx.insert is called once for mcpGroups, once for mcpServers
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);

      // The values() arg for the server insert should include organizationId
      const serverValuesCall = tx.values.mock.calls.find(
        ([vals]: any[]) => vals && 'transportType' in vals,
      );
      expect(serverValuesCall).toBeDefined();
      expect(serverValuesCall![0].organizationId).toBe(orgId);
    });

    it('stamps created servers with null organizationId when called from syncAllTemplates (bootstrap)', async () => {
      await service.syncAllTemplates();

      const serverValuesCall = tx.values.mock.calls.find(
        ([vals]: any[]) => vals && 'transportType' in vals,
      );
      expect(serverValuesCall).toBeDefined();
      expect(serverValuesCall![0].organizationId).toBeNull();
    });
  });

  describe('syncTemplate – update path (group already exists)', () => {
    beforeEach(() => {
      (groupsRepository.findBySlug as ReturnType<typeof jest.fn>).mockResolvedValue({
        id: 'group-uuid-existing',
        slug: 'test-group',
        templateHash: 'old-hash', // different → triggers update
      });
    });

    it('stamps newly created servers with the provided organizationId on update', async () => {
      const orgId = 'org-xyz-456';

      // select().from().where().limit() returns [] → no existing server → insert branch
      await service.syncTemplate('test-group', false, orgId);

      const serverValuesCall = tx.values.mock.calls.find(
        ([vals]: any[]) => vals && 'transportType' in vals,
      );
      expect(serverValuesCall).toBeDefined();
      expect(serverValuesCall![0].organizationId).toBe(orgId);
    });
  });

  describe('syncTemplate – skipped path (template hash matches)', () => {
    it('returns skipped action and does not insert any servers', async () => {
      (groupsRepository.findBySlug as ReturnType<typeof jest.fn>).mockResolvedValue({
        id: 'group-uuid-existing',
        slug: 'test-group',
        templateHash: 'mock-hash-abc', // same hash → skip
      });

      const result = await service.syncTemplate('test-group', false, 'org-any');
      expect(result.action).toBe('skipped');
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  describe('syncTemplate – unknown slug', () => {
    it('throws when template slug is not found', async () => {
      await expect(service.syncTemplate('nonexistent-slug')).rejects.toThrow(
        "Template 'nonexistent-slug' not found",
      );
    });
  });
});
