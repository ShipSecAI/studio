import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { GitHubAppService } from '../github-app.service';
import type { AuthContext } from '../../auth/types';

function makeRuleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    name: 'Rule',
    description: null,
    repositoryPattern: 'org/*',
    event: 'pull_request',
    actions: ['opened'],
    branches: ['main'],
    workflowId: '11111111-1111-1111-1111-111111111111',
    postPrComment: true,
    createCheckRun: true,
    postPrReview: false,
    failOn: 'high',
    enabled: true,
    priority: 100,
    organizationId: 'org-1',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeScanRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-02-10T05:00:00.000Z');
  return {
    id: 'scan-1',
    repositoryId: 'repo-1',
    workflowRunId: 'run-1',
    sourceType: 'manual',
    prNumber: null,
    branch: 'main',
    commitSha: null,
    status: 'failure',
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findingsCount: 0,
    findings: [],
    checkRunId: null,
    prCommentId: null,
    prReviewId: null,
    resultsUrl: null,
    errorMessage: 'Missing PR context: prNumber not provided',
    triggerRuleId: null,
    organizationId: 'org-1',
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    workflowName: 'Unified AI Security Review',
    workflowVersion: 4,
    triggerType: 'schedule',
    triggerSource: 'sched-1',
    triggerLabel: 'Nightly Dependency Audit',
    ...overrides,
  };
}

describe('GitHubAppService', () => {
  let service: GitHubAppService;
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  const auth: AuthContext = {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: [],
    isAuthenticated: true,
    provider: 'test',
  };

  beforeEach(() => {
    repository = {
      createTriggerRule: vi.fn(),
      updateTriggerRule: vi.fn(),
      findTriggerRuleById: vi.fn(),
      listScanResultsByOrg: vi.fn(),
    };

    service = new GitHubAppService(
      {
        get: vi.fn().mockReturnValue({
          appId: '1',
          privateKey: 'dummy',
          baseUrl: 'https://github.com',
          apiBaseUrl: 'https://api.github.com',
        }),
      } as any,
      repository as any,
      {} as any,
      {} as any,
    );
  });

  describe('trigger rule CRUD pass-through', () => {
    it('defaults postPrReview to false on create when omitted', async () => {
      repository.createTriggerRule.mockResolvedValue(makeRuleRecord({ postPrReview: false }));

      const result = await service.createTriggerRule(
        {
          name: 'Rule',
          repositoryPattern: 'org/*',
          event: 'pull_request',
          workflowId: '11111111-1111-1111-1111-111111111111',
        } as any,
        auth,
      );

      expect(repository.createTriggerRule).toHaveBeenCalledWith(
        expect.objectContaining({ postPrReview: false }),
      );
      expect(result.postPrReview).toBe(false);
    });

    it('passes postPrReview true on create', async () => {
      repository.createTriggerRule.mockResolvedValue(makeRuleRecord({ postPrReview: true }));

      const result = await service.createTriggerRule(
        {
          name: 'Rule',
          repositoryPattern: 'org/*',
          event: 'pull_request',
          workflowId: '11111111-1111-1111-1111-111111111111',
          postPrReview: true,
        } as any,
        auth,
      );

      expect(repository.createTriggerRule).toHaveBeenCalledWith(
        expect.objectContaining({ postPrReview: true }),
      );
      expect(result.postPrReview).toBe(true);
    });

    it('updates postPrReview when provided', async () => {
      repository.findTriggerRuleById.mockResolvedValue(
        makeRuleRecord({ id: 'rule-1', organizationId: 'org-1' }),
      );
      repository.updateTriggerRule.mockResolvedValue(makeRuleRecord({ postPrReview: true }));

      const result = await service.updateTriggerRule('rule-1', { postPrReview: true } as any, auth);

      expect(repository.updateTriggerRule).toHaveBeenCalledWith(
        'rule-1',
        expect.objectContaining({ postPrReview: true }),
      );
      expect(result.postPrReview).toBe(true);
    });
  });

  describe('getPullRequestFiles pagination', () => {
    it('returns one page when fewer than 100 files', async () => {
      const apiSpy = vi.spyOn(service as any, 'githubApiRequest').mockResolvedValue([
        { filename: 'a.ts', status: 'modified' },
        { filename: 'b.ts', status: 'modified' },
      ]);

      const files = await service.getPullRequestFiles(1, 'org', 'repo', 42);

      expect(files).toHaveLength(2);
      expect(apiSpy).toHaveBeenCalledTimes(1);
    });

    it('accumulates pages until a short page is returned', async () => {
      const pageOne = Array.from({ length: 100 }, (_, i) => ({
        filename: `a-${i}.ts`,
        status: 'modified',
      }));
      const pageTwo = [{ filename: 'last.ts', status: 'modified' }];
      const apiSpy = vi
        .spyOn(service as any, 'githubApiRequest')
        .mockResolvedValueOnce(pageOne)
        .mockResolvedValueOnce(pageTwo);

      const files = await service.getPullRequestFiles(1, 'org', 'repo', 42);

      expect(files).toHaveLength(101);
      expect(apiSpy).toHaveBeenCalledTimes(2);
    });

    it('stops at 30 pages', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        filename: `f-${i}.ts`,
        status: 'modified',
      }));
      const apiSpy = vi.spyOn(service as any, 'githubApiRequest').mockResolvedValue(fullPage);

      const files = await service.getPullRequestFiles(1, 'org', 'repo', 42);

      expect(apiSpy).toHaveBeenCalledTimes(30);
      expect(files).toHaveLength(3000);
    });
  });

  describe('scan result mapping', () => {
    it('maps schedule metadata from workflow run trigger fields', async () => {
      repository.listScanResultsByOrg.mockResolvedValue([makeScanRecord()]);

      const results = await service.listScanResults(auth, {
        source: 'schedule',
        scheduleId: 'sched-1',
        triggerRuleId: 'rule-1',
      });

      expect(repository.listScanResultsByOrg).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          source: 'schedule',
          scheduleId: 'sched-1',
          triggerRuleId: 'rule-1',
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.sourceType).toBe('schedule');
      expect(results[0]?.scheduleId).toBe('sched-1');
      expect(results[0]?.scheduleName).toBe('Nightly Dependency Audit');
      expect(results[0]?.triggerType).toBe('schedule');
      expect(results[0]?.triggerSource).toBe('sched-1');
    });
  });
});
