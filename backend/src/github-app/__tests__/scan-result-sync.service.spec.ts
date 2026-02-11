import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ScanResultSyncService } from '../scan-result-sync.service';
import type { GitHubAppRepository } from '../github-app.repository';
import type { GitHubAppService } from '../github-app.service';
import type { TemporalService } from '../../temporal/temporal.service';
import type { GitHubScanResultRecord } from '../../database/schema';

function makeScanResult(overrides: Partial<GitHubScanResultRecord> = {}): GitHubScanResultRecord {
  return {
    id: 'scan-1',
    repositoryId: 'repo-1',
    workflowRunId: 'shipsec-run-abc',
    sourceType: 'pr',
    prNumber: 42,
    branch: 'main',
    commitSha: 'abc123',
    status: 'running',
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findingsCount: 0,
    findings: [],
    checkRunId: null,
    prCommentId: null,
    prReviewId: null,
    resultsUrl: null,
    errorMessage: null,
    triggerRuleId: null,
    organizationId: 'org-1',
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ScanResultSyncService', () => {
  let service: ScanResultSyncService;
  let mockRepository: {
    findRunningScanResults: ReturnType<typeof vi.fn>;
    updateScanResult: ReturnType<typeof vi.fn>;
    findTriggerRuleById: ReturnType<typeof vi.fn>;
    findRepositoryById: ReturnType<typeof vi.fn>;
    findInstallationById: ReturnType<typeof vi.fn>;
  };
  let mockTemporalService: {
    describeWorkflow: ReturnType<typeof vi.fn>;
    getWorkflowResult: ReturnType<typeof vi.fn>;
  };
  let mockGitHubAppService: {
    updateCheckRun: ReturnType<typeof vi.fn>;
    getPullRequestFiles: ReturnType<typeof vi.fn>;
    createPullRequestReview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepository = {
      findRunningScanResults: vi.fn().mockResolvedValue([]),
      updateScanResult: vi.fn().mockResolvedValue(undefined),
      findTriggerRuleById: vi.fn().mockResolvedValue(null),
      findRepositoryById: vi.fn().mockResolvedValue(null),
      findInstallationById: vi.fn().mockResolvedValue(null),
    };

    mockTemporalService = {
      describeWorkflow: vi.fn(),
      getWorkflowResult: vi.fn(),
    };

    mockGitHubAppService = {
      updateCheckRun: vi.fn().mockResolvedValue(undefined),
      getPullRequestFiles: vi.fn().mockResolvedValue([]),
      createPullRequestReview: vi.fn(),
    };

    service = new ScanResultSyncService(
      mockRepository as unknown as GitHubAppRepository,
      mockTemporalService as unknown as TemporalService,
      mockGitHubAppService as unknown as GitHubAppService,
    );
  });

  // ============ Core sync behavior ============

  it('should skip when no running scan results exist', async () => {
    mockRepository.findRunningScanResults.mockResolvedValue([]);
    await service.syncRunningScanResults();
    expect(mockTemporalService.describeWorkflow).not.toHaveBeenCalled();
  });

  it('should skip scan results whose workflow is still running', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      runId: 'temporal-run-1',
      status: 'RUNNING',
      startTime: new Date().toISOString(),
    });

    await service.syncRunningScanResults();
    expect(mockRepository.updateScanResult).not.toHaveBeenCalled();
  });

  it('should mark scan as success when workflow completes with findings', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'COMPLETED',
    });
    mockTemporalService.getWorkflowResult.mockResolvedValue({
      outputs: {
        'normalize-1': {
          summary: { critical: 1, high: 2, medium: 0, low: 0, info: 0 },
          findingCount: 3,
        },
        'check-1': {
          checkRunId: 12345,
        },
        'comment-1': {
          commentId: 67890,
        },
      },
      success: true,
    });

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'success',
      summary: { critical: 1, high: 2, medium: 0, low: 0, info: 0 },
      findingsCount: 3,
      findings: [],
      checkRunId: 12345,
      prCommentId: 67890,
      completedAt: expect.any(Date),
    });
  });

  it('should merge findings across normalize nodes and map findings fields', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'COMPLETED',
    });
    mockTemporalService.getWorkflowResult.mockResolvedValue({
      outputs: {
        'normalize-1': {
          summary: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
          findingCount: 2,
          findings: [
            {
              finding_hash: 'th-1',
              scanner: 'trufflehog',
              severity: 'HIGH',
              file: 'src/secrets.ts',
              line: 7,
              description: 'Detected AWS key',
              snippet: 'AKIA....',
              rule_id: 'aws_access_key',
            },
          ],
        },
        'normalize-2': {
          summary: { critical: 0, high: 0, medium: 1, low: 1, info: 0 },
          findings: [
            {
              id: 'og-1',
              scanner: 'opengrep',
              severity: 'medium',
              file: 'src/db.ts',
              line: 12,
              message: 'Potential SQL injection',
              rule_id: 'sql-injection',
            },
            {
              id: 'misc-1',
              type: 'custom-finding',
              severity: 'unexpected',
              file: 'README.md',
              title: 'Unexpected output shape',
            },
            {
              id: 'empty-desc-1',
              scanner: 'custom-scanner',
              severity: 'low',
              file: 'src/custom.ts',
              description: '   ',
              message: 'Fallback message should be preserved',
            },
          ],
        },
        'check-1': {
          checkRunId: 12345,
        },
        'comment-1': {
          commentId: 67890,
        },
      },
      success: true,
    });

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({
        status: 'success',
        summary: { critical: 1, high: 1, medium: 1, low: 1, info: 0 },
        findingsCount: 4,
        checkRunId: 12345,
        prCommentId: 67890,
        findings: expect.arrayContaining([
          expect.objectContaining({
            id: 'th-1',
            type: 'trufflehog',
            severity: 'high',
            file: 'src/secrets.ts',
            line: 7,
            message: 'Detected AWS key',
            ruleId: 'aws_access_key',
            category: 'trufflehog',
          }),
          expect.objectContaining({
            id: 'og-1',
            type: 'opengrep',
            severity: 'medium',
            file: 'src/db.ts',
            line: 12,
            message: 'Potential SQL injection',
            ruleId: 'sql-injection',
            category: 'opengrep',
          }),
          expect.objectContaining({
            id: 'misc-1',
            type: 'custom-finding',
            severity: 'info',
            file: 'README.md',
            message: 'Unexpected output shape',
          }),
          expect.objectContaining({
            id: 'empty-desc-1',
            type: 'custom-scanner',
            severity: 'low',
            file: 'src/custom.ts',
            message: 'Fallback message should be preserved',
          }),
        ]),
        completedAt: expect.any(Date),
      }),
    );
  });

  it('should mark scan as failure when result extraction fails', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'COMPLETED',
    });
    mockTemporalService.getWorkflowResult.mockRejectedValue(new Error('result not found'));

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'failure',
      errorMessage: expect.stringContaining('result not found'),
      completedAt: expect.any(Date),
    });
  });

  it('should mark scan as failure when workflow fails', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'FAILED',
      failure: { message: 'Component timeout' },
    });

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'failure',
      errorMessage: 'Component timeout',
      completedAt: expect.any(Date),
    });
  });

  it('should mark scan as failure when workflow is cancelled', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'CANCELLED',
      failure: undefined,
    });

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'failure',
      errorMessage: 'Workflow CANCELLED',
      completedAt: expect.any(Date),
    });
  });

  it('should mark scan as failure when workflow not found in Temporal', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockRejectedValue(new Error('not found'));

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'failure',
      errorMessage: 'Workflow run not found',
      completedAt: expect.any(Date),
    });
  });

  it('should handle multiple scan results independently', async () => {
    const scan1 = makeScanResult({ id: 'scan-1', workflowRunId: 'run-1' });
    const scan2 = makeScanResult({ id: 'scan-2', workflowRunId: 'run-2' });
    mockRepository.findRunningScanResults.mockResolvedValue([scan1, scan2]);

    mockTemporalService.describeWorkflow
      .mockResolvedValueOnce({ workflowId: 'run-1', status: 'COMPLETED' })
      .mockResolvedValueOnce({ workflowId: 'run-2', status: 'RUNNING' });
    mockTemporalService.getWorkflowResult.mockResolvedValueOnce({
      outputs: {},
      success: true,
    });

    await service.syncRunningScanResults();

    // First should be updated, second should not
    expect(mockRepository.updateScanResult).toHaveBeenCalledTimes(1);
    expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
      status: 'success',
      completedAt: expect.any(Date),
    });
  });

  it('should allow commentId overwrite (last valid wins)', async () => {
    const scanResult = makeScanResult();
    mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
    mockTemporalService.describeWorkflow.mockResolvedValue({
      workflowId: 'shipsec-run-abc',
      status: 'COMPLETED',
    });
    mockTemporalService.getWorkflowResult.mockResolvedValue({
      outputs: {
        'comment-rule-a': { commentId: 111 },
        'comment-rule-b': { commentId: 222 },
      },
      success: true,
    });

    await service.syncRunningScanResults();

    expect(mockRepository.updateScanResult).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ prCommentId: 222 }),
    );
  });

  // ============ postPrReviewIfEnabled ============

  describe('postPrReviewIfEnabled', () => {
    const setupReviewContext = () => {
      mockRepository.findRepositoryById.mockResolvedValue({
        id: 'repo-1',
        installationId: 'install-1',
        fullName: 'myorg/myrepo',
      });
      mockRepository.findInstallationById.mockResolvedValue({
        id: 'install-1',
        installationId: 99999,
      });
      mockRepository.findTriggerRuleById.mockResolvedValue({
        id: 'rule-1',
        failOn: 'high',
        postPrReview: true,
      });
      mockGitHubAppService.getPullRequestFiles.mockResolvedValue([
        {
          filename: 'src/a.ts',
          status: 'modified',
          patch: '@@ -1,1 +1,6 @@\n context\n+new line',
        },
      ]);
    };

    it('posts review with inline comments for findings in diff hunks', async () => {
      setupReviewContext();
      mockGitHubAppService.createPullRequestReview.mockResolvedValue({
        id: 900,
        html_url: 'https://github.com/myorg/myrepo/pull/1#pullrequestreview-900',
      });

      const scanResult = makeScanResult({ triggerRuleId: 'rule-1' });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          normalize: {
            summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findingCount: 2,
            findings: [
              {
                scanner: 'opengrep',
                severity: 'high',
                file: 'src/a.ts',
                line: 2,
                message: 'Inline issue',
                rule_id: 'rule-a',
              },
              {
                scanner: 'opengrep',
                severity: 'medium',
                file: 'src/a.ts',
                line: 200,
                message: 'Outside diff',
                rule_id: 'rule-b',
              },
            ],
          },
        },
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.createPullRequestReview).toHaveBeenCalledTimes(1);
      expect(mockGitHubAppService.createPullRequestReview).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        42,
        expect.objectContaining({
          event: 'COMMENT',
          comments: [
            expect.objectContaining({
              path: 'src/a.ts',
              line: 2,
              side: 'RIGHT',
            }),
          ],
        }),
      );
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', { prReviewId: 900 });
    });

    it('skips review posting when prReviewId already exists', async () => {
      setupReviewContext();
      const scanResult = makeScanResult({ triggerRuleId: 'rule-1', prReviewId: 1234 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          normalize: {
            summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findingCount: 1,
            findings: [{ scanner: 'x', severity: 'high', file: 'src/a.ts', line: 2, message: 'x' }],
          },
        },
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.getPullRequestFiles).not.toHaveBeenCalled();
      expect(mockGitHubAppService.createPullRequestReview).not.toHaveBeenCalled();
    });

    it('falls back to body-only review on 422', async () => {
      setupReviewContext();
      mockGitHubAppService.createPullRequestReview
        .mockResolvedValueOnce({ status: 422, error: 'Validation failed' })
        .mockResolvedValueOnce({
          id: 901,
          html_url: 'https://github.com/myorg/myrepo/pull/1#pullrequestreview-901',
        });

      const scanResult = makeScanResult({ triggerRuleId: 'rule-1' });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          normalize: {
            summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findingCount: 1,
            findings: [{ scanner: 'x', severity: 'high', file: 'src/a.ts', line: 2, message: 'x' }],
          },
        },
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.createPullRequestReview).toHaveBeenCalledTimes(2);
      expect(mockGitHubAppService.createPullRequestReview.mock.calls[0][4].comments).toHaveLength(
        1,
      );
      expect(mockGitHubAppService.createPullRequestReview.mock.calls[1][4].comments).toHaveLength(
        0,
      );
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', { prReviewId: 901 });
    });

    it('logs warning and does not set prReviewId when fallback also returns 422', async () => {
      setupReviewContext();
      mockGitHubAppService.createPullRequestReview
        .mockResolvedValueOnce({ status: 422, error: 'Validation failed' })
        .mockResolvedValueOnce({ status: 422, error: 'Still invalid' });
      const warnSpy = vi.spyOn((service as any).logger, 'warn');

      const scanResult = makeScanResult({ triggerRuleId: 'rule-1' });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          normalize: {
            summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findingCount: 1,
            findings: [{ scanner: 'x', severity: 'high', file: 'src/a.ts', line: 2, message: 'x' }],
          },
        },
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.createPullRequestReview).toHaveBeenCalledTimes(2);
      expect(
        mockRepository.updateScanResult.mock.calls.some(
          (call) => call[0] === 'scan-1' && call[1]?.prReviewId != null,
        ),
      ).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('includes capped finding count when inline-eligible findings exceed 50', async () => {
      setupReviewContext();
      mockGitHubAppService.createPullRequestReview.mockResolvedValue({
        id: 902,
        html_url: 'https://github.com/myorg/myrepo/pull/1#pullrequestreview-902',
      });

      const findings = Array.from({ length: 51 }, (_, i) => ({
        scanner: 'opengrep',
        severity: 'high',
        file: 'src/a.ts',
        line: 2,
        message: `issue-${i}`,
        rule_id: `rule-${i}`,
      }));

      const scanResult = makeScanResult({ triggerRuleId: 'rule-1' });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          normalize: {
            summary: { critical: 0, high: 51, medium: 0, low: 0, info: 0 },
            findingCount: 51,
            findings,
          },
        },
      });

      await service.syncRunningScanResults();

      const payload = mockGitHubAppService.createPullRequestReview.mock.calls[0][4];
      expect(payload.comments).toHaveLength(50);
      expect(payload.body).toContain('additional inline-eligible findings not posted');
    });
  });

  // ============ evaluateFailOn ============

  describe('evaluateFailOn', () => {
    it('should return success when failOn is none', () => {
      const summary = { critical: 5, high: 3, medium: 2, low: 1, info: 10 };
      expect(service.evaluateFailOn('none', summary)).toBe('success');
    });

    it('should return failure when failOn is info and any finding exists', () => {
      expect(
        service.evaluateFailOn('info', { critical: 0, high: 0, medium: 0, low: 0, info: 1 }),
      ).toBe('failure');
    });

    it('should return success when failOn is info and no findings exist', () => {
      expect(
        service.evaluateFailOn('info', { critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
      ).toBe('success');
    });

    it('should return failure when failOn is critical and critical findings exist', () => {
      expect(
        service.evaluateFailOn('critical', { critical: 1, high: 0, medium: 0, low: 0, info: 0 }),
      ).toBe('failure');
    });

    it('should return success when failOn is critical and only high findings exist', () => {
      expect(
        service.evaluateFailOn('critical', { critical: 0, high: 5, medium: 0, low: 0, info: 0 }),
      ).toBe('success');
    });

    it('should return failure when failOn is high and critical findings exist', () => {
      expect(
        service.evaluateFailOn('high', { critical: 1, high: 0, medium: 0, low: 0, info: 0 }),
      ).toBe('failure');
    });

    it('should return failure when failOn is high and high findings exist', () => {
      expect(
        service.evaluateFailOn('high', { critical: 0, high: 1, medium: 0, low: 0, info: 0 }),
      ).toBe('failure');
    });

    it('should return success when failOn is high and only medium findings exist', () => {
      expect(
        service.evaluateFailOn('high', { critical: 0, high: 0, medium: 3, low: 0, info: 0 }),
      ).toBe('success');
    });

    it('should return failure when failOn is medium and medium or above exist', () => {
      expect(
        service.evaluateFailOn('medium', { critical: 0, high: 0, medium: 1, low: 0, info: 0 }),
      ).toBe('failure');
    });

    it('should return success when failOn is medium and only low findings exist', () => {
      expect(
        service.evaluateFailOn('medium', { critical: 0, high: 0, medium: 0, low: 5, info: 0 }),
      ).toBe('success');
    });

    it('should return success for unknown failOn value', () => {
      expect(
        service.evaluateFailOn('unknown', { critical: 5, high: 5, medium: 5, low: 5, info: 5 }),
      ).toBe('success');
    });
  });

  // ============ buildAnnotations ============

  describe('buildAnnotations', () => {
    it('should filter out findings without file', () => {
      const findings = [
        { severity: 'high', line: 5, message: 'issue' },
        { file: 'src/a.ts', severity: 'high', line: 5, message: 'valid' },
      ];
      const annotations = service.buildAnnotations(findings);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].path).toBe('src/a.ts');
    });

    it('should filter out findings without valid line', () => {
      const findings = [
        { file: 'a.ts', severity: 'high', line: 0, message: 'zero line' },
        { file: 'b.ts', severity: 'high', line: -1, message: 'negative line' },
        { file: 'c.ts', severity: 'high', line: 1.5, message: 'float line' },
        { file: 'd.ts', severity: 'high', message: 'no line' },
        { file: 'e.ts', severity: 'high', line: 10, message: 'valid' },
      ];
      const annotations = service.buildAnnotations(findings);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].path).toBe('e.ts');
    });

    it('should map severity to annotation level correctly', () => {
      const findings = [
        { file: 'a.ts', severity: 'critical', line: 1, message: 'crit' },
        { file: 'b.ts', severity: 'high', line: 2, message: 'high' },
        { file: 'c.ts', severity: 'medium', line: 3, message: 'med' },
        { file: 'd.ts', severity: 'low', line: 4, message: 'low' },
        { file: 'e.ts', severity: 'info', line: 5, message: 'info' },
      ];
      const annotations = service.buildAnnotations(findings);
      expect(annotations).toHaveLength(5);
      expect(annotations[0].annotation_level).toBe('failure');
      expect(annotations[1].annotation_level).toBe('failure');
      expect(annotations[2].annotation_level).toBe('warning');
      expect(annotations[3].annotation_level).toBe('notice');
      expect(annotations[4].annotation_level).toBe('notice');
    });

    it('should truncate to 50 annotations', () => {
      const findings = Array.from({ length: 60 }, (_, i) => ({
        file: `file-${i}.ts`,
        severity: 'high',
        line: i + 1,
        message: `finding ${i}`,
      }));
      const annotations = service.buildAnnotations(findings);
      expect(annotations).toHaveLength(50);
    });

    it('should use endLine when valid', () => {
      const findings = [
        { file: 'a.ts', severity: 'high', line: 5, endLine: 10, message: 'multi-line' },
        { file: 'b.ts', severity: 'high', line: 5, endLine: 3, message: 'invalid endLine' },
      ];
      const annotations = service.buildAnnotations(findings);
      expect(annotations[0].start_line).toBe(5);
      expect(annotations[0].end_line).toBe(10);
      // Invalid endLine (< line) should fall back to line
      expect(annotations[1].end_line).toBe(5);
    });

    it('should use type as title when available', () => {
      const findings = [
        { file: 'a.ts', severity: 'high', line: 1, message: 'issue', type: 'trufflehog' },
        { file: 'b.ts', severity: 'high', line: 1, message: 'issue' },
      ];
      const annotations = service.buildAnnotations(findings);
      expect(annotations[0].title).toBe('trufflehog');
      expect(annotations[1].title).toBeUndefined();
    });
  });

  // ============ mapSeverityToAnnotationLevel ============

  describe('mapSeverityToAnnotationLevel', () => {
    it('should map critical to failure', () => {
      expect(service.mapSeverityToAnnotationLevel('critical')).toBe('failure');
    });

    it('should map high to failure', () => {
      expect(service.mapSeverityToAnnotationLevel('high')).toBe('failure');
    });

    it('should map medium to warning', () => {
      expect(service.mapSeverityToAnnotationLevel('medium')).toBe('warning');
    });

    it('should map low to notice', () => {
      expect(service.mapSeverityToAnnotationLevel('low')).toBe('notice');
    });

    it('should map info to notice', () => {
      expect(service.mapSeverityToAnnotationLevel('info')).toBe('notice');
    });

    it('should map unknown to notice', () => {
      expect(service.mapSeverityToAnnotationLevel('unknown')).toBe('notice');
    });

    it('should be case-insensitive', () => {
      expect(service.mapSeverityToAnnotationLevel('CRITICAL')).toBe('failure');
      expect(service.mapSeverityToAnnotationLevel('HIGH')).toBe('failure');
      expect(service.mapSeverityToAnnotationLevel('Medium')).toBe('warning');
    });
  });

  // ============ Check run finalization ============

  describe('check run finalization', () => {
    const setupCheckRunContext = () => {
      mockRepository.findRepositoryById.mockResolvedValue({
        id: 'repo-1',
        installationId: 'install-1',
        fullName: 'myorg/myrepo',
      });
      mockRepository.findInstallationById.mockResolvedValue({
        id: 'install-1',
        installationId: 99999,
      });
    };

    it('should finalize check run on COMPLETED with findings', async () => {
      setupCheckRunContext();
      mockRepository.findTriggerRuleById.mockResolvedValue({
        id: 'rule-1',
        failOn: 'high',
      });

      const scanResult = makeScanResult({
        checkRunId: 5001,
        triggerRuleId: 'rule-1',
      });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          'normalize-1': {
            summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
            findingCount: 1,
            findings: [
              {
                id: 'f-1',
                scanner: 'trufflehog',
                severity: 'high',
                file: 'src/secrets.ts',
                line: 10,
                message: 'AWS key detected',
              },
            ],
          },
        },
        success: true,
      });

      await service.syncRunningScanResults();

      // Check run should be finalized with failure (high >= high threshold)
      expect(mockGitHubAppService.updateCheckRun).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        5001,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'failure',
          output: expect.objectContaining({
            title: expect.stringContaining('failed'),
            annotations: expect.arrayContaining([
              expect.objectContaining({
                path: 'src/secrets.ts',
                start_line: 10,
                annotation_level: 'failure',
                message: 'AWS key detected',
              }),
            ]),
          }),
        }),
      );

      // Scan result should still be marked success (the workflow succeeded)
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('should finalize check run with success when below threshold', async () => {
      setupCheckRunContext();
      mockRepository.findTriggerRuleById.mockResolvedValue({
        id: 'rule-1',
        failOn: 'high',
      });

      const scanResult = makeScanResult({
        checkRunId: 5002,
        triggerRuleId: 'rule-1',
      });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {
          'normalize-1': {
            summary: { critical: 0, high: 0, medium: 2, low: 1, info: 0 },
            findingCount: 3,
          },
        },
        success: true,
      });

      await service.syncRunningScanResults();

      // Check run should pass (only medium/low, threshold is high)
      expect(mockGitHubAppService.updateCheckRun).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        5002,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'success',
          output: expect.objectContaining({
            title: expect.stringContaining('passed'),
          }),
        }),
      );
    });

    it('should skip check run finalization when checkRunId is null', async () => {
      const scanResult = makeScanResult({ checkRunId: null });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {},
        success: true,
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.updateCheckRun).not.toHaveBeenCalled();
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('should finalize check run with failure on FAILED workflow', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5003 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'FAILED',
        failure: { message: 'Component timeout' },
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.updateCheckRun).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        5003,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'failure',
        }),
      );

      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
        status: 'failure',
        errorMessage: 'Component timeout',
        completedAt: expect.any(Date),
      });
    });

    it('should finalize check run with cancelled on CANCELLED workflow', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5004 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'CANCELLED',
        failure: undefined,
      });

      await service.syncRunningScanResults();

      expect(mockGitHubAppService.updateCheckRun).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        5004,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'cancelled',
        }),
      );
    });

    it('should keep scan as running on transient check run update error', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5005 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {},
        success: true,
      });

      mockGitHubAppService.updateCheckRun.mockRejectedValue(new Error('502 Bad Gateway'));

      await service.syncRunningScanResults();

      // Scan should NOT be updated (kept as running for retry)
      expect(mockRepository.updateScanResult).not.toHaveBeenCalled();
    });

    it('should clear checkRunId and proceed when check run returns 404', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5006 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {},
        success: true,
      });

      mockGitHubAppService.updateCheckRun.mockRejectedValue(new Error('404 Not Found'));

      await service.syncRunningScanResults();

      // checkRunId should be cleared
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
        checkRunId: null,
      });
      // Scan should then be marked success (second call)
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith(
        'scan-1',
        expect.objectContaining({ status: 'success' }),
      );
    });

    it('should clear checkRunId and proceed when check run returns 410', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5007 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockResolvedValue({
        outputs: {},
        success: true,
      });

      mockGitHubAppService.updateCheckRun.mockRejectedValue(new Error('410 Gone'));

      await service.syncRunningScanResults();

      // checkRunId should be cleared
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
        checkRunId: null,
      });
    });

    it('should finalize check run on extraction failure with checkRunId', async () => {
      setupCheckRunContext();

      const scanResult = makeScanResult({ checkRunId: 5008 });
      mockRepository.findRunningScanResults.mockResolvedValue([scanResult]);
      mockTemporalService.describeWorkflow.mockResolvedValue({
        workflowId: 'shipsec-run-abc',
        status: 'COMPLETED',
      });
      mockTemporalService.getWorkflowResult.mockRejectedValue(new Error('extraction error'));

      await service.syncRunningScanResults();

      // Check run should be finalized with failure
      expect(mockGitHubAppService.updateCheckRun).toHaveBeenCalledWith(
        99999,
        'myorg',
        'myrepo',
        5008,
        expect.objectContaining({
          status: 'completed',
          conclusion: 'failure',
        }),
      );

      // Scan should be marked failure
      expect(mockRepository.updateScanResult).toHaveBeenCalledWith('scan-1', {
        status: 'failure',
        errorMessage: expect.stringContaining('extraction error'),
        completedAt: expect.any(Date),
      });
    });
  });
});
