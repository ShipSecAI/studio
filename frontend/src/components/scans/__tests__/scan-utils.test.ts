import { describe, expect, it } from 'bun:test';
import type { GitHubScanResult } from '@/store/githubStore';
import { getScanFailureGuidance, getScanSourceMeta } from '../scan-utils';

function makeScan(overrides: Partial<GitHubScanResult> = {}): GitHubScanResult {
  return {
    id: 'scan-1',
    repositoryId: 'repo-1',
    workflowRunId: 'run-1',
    sourceType: 'manual',
    triggerType: null,
    triggerSource: null,
    triggerLabel: null,
    scheduleId: null,
    scheduleName: null,
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
    errorMessage: null,
    triggerRuleId: null,
    organizationId: 'org-1',
    startedAt: null,
    completedAt: null,
    createdAt: '2026-02-10T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z',
    workflowName: null,
    workflowVersion: null,
    ...overrides,
  };
}

describe('scan-utils source metadata', () => {
  it('maps schedule metadata when run trigger is schedule', () => {
    const source = getScanSourceMeta(
      makeScan({
        sourceType: 'manual',
        triggerType: 'schedule',
        triggerSource: 'sched-123',
        triggerLabel: 'Nightly Dependency Audit',
      }),
    );

    expect(source.kind).toBe('schedule');
    expect(source.scheduleId).toBe('sched-123');
    expect(source.scheduleName).toBe('Nightly Dependency Audit');
    expect(source.detail).toBe('Nightly Dependency Audit');
  });

  it('maps PR metadata from sourceType/prNumber', () => {
    const source = getScanSourceMeta(
      makeScan({
        sourceType: 'pr',
        prNumber: 42,
      }),
    );

    expect(source.kind).toBe('pr');
    expect(source.label).toBe('PR');
    expect(source.detail).toBe('#42');
  });
});

describe('scan-utils failure guidance', () => {
  it('suggests PR-trigger remediation for missing PR context', () => {
    const guidance = getScanFailureGuidance(
      makeScan({
        errorMessage: 'Missing PR context: prNumber not provided for manual run.',
      }),
    );

    expect(guidance.suggestion).toContain('PR trigger rule');
  });

  it('suggests permission remediation for GitHub permission errors', () => {
    const guidance = getScanFailureGuidance(
      makeScan({
        errorMessage: 'GitHub comment API permission denied for installation.',
      }),
    );

    expect(guidance.suggestion).toContain('permissions');
  });
});
