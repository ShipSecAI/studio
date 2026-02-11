import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { GitHubAppRepository } from './github-app.repository';
import { GitHubAppService } from './github-app.service';
import { TemporalService } from '../temporal/temporal.service';
import type { GitHubScanResultRecord, NewGitHubScanResultRecord } from '../database/schema';
import {
  buildPatchMap,
  escapeBackticks,
  escapeMarkdown,
  isLineInDiffHunks,
  safeTruncate,
  stripWorkspacePrefix,
} from './diff-hunk-parser';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'];
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_ANNOTATIONS = 50;
const MAX_REVIEW_INLINE_COMMENTS = 50;
const MAX_REVIEW_SKIPPED_IN_BODY = 20;
const MAX_REVIEW_BODY_LENGTH = 65_535;
const MAX_REVIEW_COMMENT_LENGTH = 65_535;
const MAX_REVIEW_SNIPPET_LENGTH = 500;

/** Severity levels in descending order of severity */
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface ReviewFindingSummary {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  message: string;
  ruleId?: string;
  category?: string;
  snippet?: string;
}

/**
 * Polls for scan results in 'running' state and syncs their status
 * with the corresponding Temporal workflow execution.
 * Also finalizes GitHub check runs with conclusions, annotations, and output.
 */
@Injectable()
export class ScanResultSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScanResultSyncService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(
    private readonly repository: GitHubAppRepository,
    private readonly temporalService: TemporalService,
    private readonly githubAppService: GitHubAppService,
  ) {}

  onModuleInit() {
    this.intervalHandle = setInterval(() => {
      this.syncRunningScanResults().catch((err) => {
        this.logger.error(`Scan result sync failed: ${err}`);
      });
    }, POLL_INTERVAL_MS);
    this.logger.log('Scan result sync service started');
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async syncRunningScanResults(): Promise<void> {
    // Guard against concurrent runs
    if (this.syncing) return;
    this.syncing = true;

    try {
      const runningScanResults = await this.repository.findRunningScanResults();
      if (runningScanResults.length === 0) return;

      this.logger.debug(`Syncing ${runningScanResults.length} running scan results`);

      for (const scanResult of runningScanResults) {
        try {
          await this.syncScanResult(scanResult);
        } catch (err) {
          this.logger.warn(
            `Failed to sync scan result ${scanResult.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private async syncScanResult(scanResult: GitHubScanResultRecord): Promise<void> {
    let temporalStatus;
    try {
      temporalStatus = await this.temporalService.describeWorkflow({
        workflowId: scanResult.workflowRunId,
      });
    } catch {
      // Workflow not found in Temporal — mark scan as failed
      this.logger.warn(
        `Workflow run ${scanResult.workflowRunId} not found in Temporal, marking scan as failed`,
      );
      await this.finalizeCheckRun(scanResult, 'failure', 'Workflow run not found');
      await this.repository.updateScanResult(scanResult.id, {
        status: 'failure',
        errorMessage: 'Workflow run not found',
        completedAt: new Date(),
      });
      return;
    }

    if (!TERMINAL_STATUSES.includes(temporalStatus.status)) {
      return; // Still running
    }

    if (temporalStatus.status === 'COMPLETED') {
      let extractedData: Partial<NewGitHubScanResultRecord>;
      try {
        const result = await this.temporalService.getWorkflowResult({
          workflowId: scanResult.workflowRunId,
        });
        extractedData = this.extractScanDataFromResult(result);
      } catch (err) {
        // Extraction failure after COMPLETED — mark as failure per spec
        const extractionError = `Failed to extract results: ${err instanceof Error ? err.message : err}`;
        this.logger.warn(`Could not extract results for scan ${scanResult.id}: ${extractionError}`);
        await this.finalizeCheckRun(scanResult, 'failure', extractionError);
        await this.repository.updateScanResult(scanResult.id, {
          status: 'failure',
          errorMessage: extractionError,
          completedAt: new Date(),
        });
        return;
      }

      // Determine check run conclusion based on failOn threshold
      const summary = (extractedData.summary ?? scanResult.summary) as ScanSummary;
      const conclusion = await this.determineConclusion(scanResult, summary);

      // Finalize check run before persisting terminal scan status
      const annotations = this.buildAnnotations(extractedData.findings ?? []);
      const finalized = await this.finalizeCheckRunWithFindings(
        scanResult,
        conclusion,
        summary,
        annotations,
      );

      if (!finalized) {
        // Transient error — keep scan as running, retry next poll
        return;
      }

      // Best-effort PR review posting, controlled by trigger rule.
      try {
        await this.postPrReviewIfEnabled(scanResult, extractedData.findings ?? []);
      } catch (err) {
        this.logger.warn(`Failed to post PR review for scan ${scanResult.id}: ${err}`);
      }

      await this.repository.updateScanResult(scanResult.id, {
        status: 'success',
        ...extractedData,
        completedAt: new Date(),
      });

      this.logger.log(
        `Scan result ${scanResult.id} completed: ${extractedData.findingsCount ?? 0} findings`,
      );
    } else {
      // FAILED, CANCELLED, TERMINATED, TIMED_OUT
      const failureReason =
        temporalStatus.failure && typeof temporalStatus.failure === 'object'
          ? ((temporalStatus.failure as Record<string, unknown>).message ??
            (temporalStatus.failure as Record<string, unknown>).reason)
          : undefined;

      const errorMessage =
        typeof failureReason === 'string' ? failureReason : `Workflow ${temporalStatus.status}`;

      const checkConclusion = temporalStatus.status === 'CANCELLED' ? 'cancelled' : 'failure';
      await this.finalizeCheckRun(scanResult, checkConclusion, errorMessage);

      await this.repository.updateScanResult(scanResult.id, {
        status: 'failure',
        errorMessage,
        completedAt: new Date(),
      });

      this.logger.log(`Scan result ${scanResult.id} failed: ${temporalStatus.status}`);
    }
  }

  /**
   * Determine the check run conclusion by evaluating the failOn threshold
   * from the trigger rule against the scan summary.
   */
  private async determineConclusion(
    scanResult: GitHubScanResultRecord,
    summary: ScanSummary,
  ): Promise<'success' | 'failure'> {
    if (!scanResult.triggerRuleId) return 'success';

    try {
      const rule = await this.repository.findTriggerRuleById(scanResult.triggerRuleId);
      if (!rule) return 'success';
      return this.evaluateFailOn(rule.failOn, summary);
    } catch {
      return 'success'; // If we can't load the rule, don't block
    }
  }

  /**
   * Evaluate whether the check run should fail based on the failOn threshold.
   */
  evaluateFailOn(failOn: string, summary: ScanSummary): 'success' | 'failure' {
    if (failOn === 'none') return 'success';

    const thresholdIndex = SEVERITY_ORDER.indexOf(failOn as (typeof SEVERITY_ORDER)[number]);
    if (thresholdIndex === -1) return 'success';

    // Check all severities at or above the threshold
    for (let i = 0; i <= thresholdIndex; i++) {
      const level = SEVERITY_ORDER[i];
      if (summary[level] > 0) return 'failure';
    }

    return 'success';
  }

  /**
   * Build GitHub annotations from findings with valid file + positive line.
   * Truncates to MAX_ANNOTATIONS (50).
   */
  buildAnnotations(findings: Record<string, unknown>[]): {
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: 'notice' | 'warning' | 'failure';
    message: string;
    title?: string;
  }[] {
    const annotations: {
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: 'notice' | 'warning' | 'failure';
      message: string;
      title?: string;
    }[] = [];

    for (const finding of findings) {
      if (annotations.length >= MAX_ANNOTATIONS) break;

      const file = finding.file;
      const line = finding.line;

      // Only include findings with valid file + positive integer line
      if (typeof file !== 'string' || !file) continue;
      if (typeof line !== 'number' || line < 1 || !Number.isInteger(line)) continue;

      const endLine =
        typeof finding.endLine === 'number' && finding.endLine >= line ? finding.endLine : line;

      annotations.push({
        path: file,
        start_line: line,
        end_line: endLine,
        annotation_level: this.mapSeverityToAnnotationLevel(
          typeof finding.severity === 'string' ? finding.severity : 'info',
        ),
        message: typeof finding.message === 'string' ? finding.message : 'Finding detected',
        title: typeof finding.type === 'string' ? finding.type : undefined,
      });
    }

    return annotations;
  }

  /**
   * Map severity to GitHub annotation level.
   */
  mapSeverityToAnnotationLevel(severity: string): 'notice' | 'warning' | 'failure' {
    switch (severity.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'failure';
      case 'medium':
        return 'warning';
      default:
        return 'notice';
    }
  }

  /**
   * Simple check run finalization (no findings/annotations).
   * Used for non-completed workflows (failed, cancelled, etc.).
   */
  private async finalizeCheckRun(
    scanResult: GitHubScanResultRecord,
    conclusion: 'success' | 'failure' | 'cancelled',
    message: string,
  ): Promise<boolean> {
    if (!scanResult.checkRunId) return true;

    try {
      const { installationId, owner, repo } = await this.resolveCheckRunContext(scanResult);

      await this.githubAppService.updateCheckRun(
        installationId,
        owner,
        repo,
        scanResult.checkRunId,
        {
          status: 'completed',
          conclusion,
          output: {
            title: conclusion === 'success' ? 'Scan passed' : 'Scan failed',
            summary: message,
          },
        },
      );
      return true;
    } catch (err) {
      return this.handleCheckRunError(err, scanResult);
    }
  }

  /**
   * Finalize check run with findings data, summary, and annotations.
   */
  private async finalizeCheckRunWithFindings(
    scanResult: GitHubScanResultRecord,
    conclusion: 'success' | 'failure',
    summary: ScanSummary,
    annotations: {
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: 'notice' | 'warning' | 'failure';
      message: string;
      title?: string;
    }[],
  ): Promise<boolean> {
    if (!scanResult.checkRunId) return true;

    try {
      const { installationId, owner, repo } = await this.resolveCheckRunContext(scanResult);

      const totalFindings =
        summary.critical + summary.high + summary.medium + summary.low + summary.info;
      const title =
        conclusion === 'success'
          ? totalFindings > 0
            ? `Scan passed — ${totalFindings} finding(s)`
            : 'Scan passed — no findings'
          : `Scan failed — ${totalFindings} finding(s)`;

      const summaryLines = [
        `| Severity | Count |`,
        `|----------|-------|`,
        `| Critical | ${summary.critical} |`,
        `| High | ${summary.high} |`,
        `| Medium | ${summary.medium} |`,
        `| Low | ${summary.low} |`,
        `| Info | ${summary.info} |`,
      ];

      if (annotations.length < totalFindings) {
        summaryLines.push(
          '',
          `> Showing ${annotations.length} of ${totalFindings} findings as annotations.`,
        );
      }

      await this.githubAppService.updateCheckRun(
        installationId,
        owner,
        repo,
        scanResult.checkRunId,
        {
          status: 'completed',
          conclusion,
          output: {
            title,
            summary: summaryLines.join('\n'),
            annotations: annotations.length > 0 ? annotations : undefined,
          },
        },
      );
      return true;
    } catch (err) {
      return this.handleCheckRunError(err, scanResult);
    }
  }

  /**
   * Resolve the GitHub context needed for check run API calls.
   */
  private async resolveCheckRunContext(
    scanResult: GitHubScanResultRecord,
  ): Promise<{ installationId: number; owner: string; repo: string }> {
    const repoRecord = await this.repository.findRepositoryById(scanResult.repositoryId);
    if (!repoRecord) throw new Error(`Repository ${scanResult.repositoryId} not found`);

    const installation = await this.repository.findInstallationById(repoRecord.installationId);
    if (!installation) throw new Error(`Installation ${repoRecord.installationId} not found`);

    const [owner, repo] = repoRecord.fullName.split('/');
    return { installationId: installation.installationId, owner, repo };
  }

  /**
   * Handle check run update errors:
   * - 404/410: check run deleted, clear checkRunId and continue
   * - transient/5xx: keep scan running, retry next poll
   */
  private async handleCheckRunError(
    err: unknown,
    scanResult: GitHubScanResultRecord,
  ): Promise<boolean> {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check for 404/410 — check run was deleted
    if (errorMessage.includes('404') || errorMessage.includes('410')) {
      this.logger.warn(
        `Check run ${scanResult.checkRunId} not found, clearing checkRunId for scan ${scanResult.id}`,
      );
      await this.repository.updateScanResult(scanResult.id, { checkRunId: null });
      return true; // Proceed with terminal status
    }

    // Transient error — keep running, retry next poll
    this.logger.warn(`Transient check run update error for scan ${scanResult.id}: ${errorMessage}`);
    return false;
  }

  private async postPrReviewIfEnabled(
    scanResult: GitHubScanResultRecord,
    findings: Record<string, unknown>[],
  ): Promise<void> {
    if (scanResult.prReviewId) return;
    if (scanResult.prNumber == null) return;
    if (!scanResult.triggerRuleId) return;

    const rule = await this.repository.findTriggerRuleById(scanResult.triggerRuleId);
    if (!rule?.postPrReview) return;

    const validFindings = this.toReviewFindingSummaries(findings);
    if (validFindings.length === 0) return;

    const { installationId, owner, repo } = await this.resolveCheckRunContext(scanResult);
    const prFiles = await this.githubAppService.getPullRequestFiles(
      installationId,
      owner,
      repo,
      scanResult.prNumber,
    );
    const patchMap = buildPatchMap(prFiles);

    const reviewComments: { path: string; line: number; side: 'RIGHT'; body: string }[] = [];
    const skippedFindings: ReviewFindingSummary[] = [];
    const cappedFindings: ReviewFindingSummary[] = [];

    for (const finding of validFindings) {
      const path = stripWorkspacePrefix(finding.file);
      const patch = patchMap.get(path);
      if (!patch || !isLineInDiffHunks(finding.line, patch)) {
        skippedFindings.push({ ...finding, file: path });
        continue;
      }

      if (reviewComments.length >= MAX_REVIEW_INLINE_COMMENTS) {
        cappedFindings.push({ ...finding, file: path });
        continue;
      }

      reviewComments.push({
        path,
        line: finding.line,
        side: 'RIGHT',
        body: this.formatReviewCommentBody(finding),
      });
    }

    if (
      reviewComments.length === 0 &&
      skippedFindings.length === 0 &&
      cappedFindings.length === 0
    ) {
      return;
    }
    if (!scanResult.commitSha) {
      this.logger.warn(`Skipping PR review for scan ${scanResult.id}: missing commit SHA`);
      return;
    }

    const summary = this.summarizeFindings(findings);
    const reviewBody = this.buildReviewBody({
      summary,
      inlineCount: reviewComments.length,
      skippedFindings,
      cappedFindingsCount: cappedFindings.length,
    });

    const firstAttempt = await this.githubAppService.createPullRequestReview(
      installationId,
      owner,
      repo,
      scanResult.prNumber,
      {
        commit_id: scanResult.commitSha,
        body: reviewBody,
        event: 'COMMENT',
        comments: reviewComments,
      },
    );

    if ('status' in firstAttempt && firstAttempt.status === 422) {
      const fallbackBody = this.buildReviewBody({
        summary,
        inlineCount: 0,
        skippedFindings: validFindings,
        cappedFindingsCount: 0,
      });

      try {
        const fallback = await this.githubAppService.createPullRequestReview(
          installationId,
          owner,
          repo,
          scanResult.prNumber,
          {
            commit_id: scanResult.commitSha,
            body: fallbackBody,
            event: 'COMMENT',
            comments: [],
          },
        );

        if ('status' in fallback) {
          this.logger.warn(
            `Fallback PR review failed with 422 for scan ${scanResult.id}: ${fallback.error}`,
          );
          return;
        }

        await this.repository.updateScanResult(scanResult.id, { prReviewId: fallback.id });
        return;
      } catch (err) {
        this.logger.warn(
          `Fallback PR review failed for scan ${scanResult.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    if ('status' in firstAttempt) {
      return;
    }

    await this.repository.updateScanResult(scanResult.id, { prReviewId: firstAttempt.id });
  }

  private toReviewFindingSummaries(findings: Record<string, unknown>[]): ReviewFindingSummary[] {
    const summaries: ReviewFindingSummary[] = [];

    for (const finding of findings) {
      const file = finding.file;
      const line = finding.line;
      if (typeof file !== 'string' || file.trim().length === 0) continue;
      if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) continue;

      summaries.push({
        file: file.trim(),
        line,
        severity: this.normalizeSeverity(finding.severity),
        message:
          typeof finding.message === 'string' && finding.message.trim().length > 0
            ? finding.message
            : 'Finding detected',
        ruleId: typeof finding.ruleId === 'string' ? finding.ruleId : undefined,
        category: typeof finding.category === 'string' ? finding.category : undefined,
        snippet: typeof finding.snippet === 'string' ? finding.snippet : undefined,
      });
    }

    return summaries;
  }

  private summarizeFindings(findings: Record<string, unknown>[]): ScanSummary {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

    for (const finding of findings) {
      const severity = this.normalizeSeverity(finding.severity);
      summary[severity] += 1;
    }

    return summary;
  }

  private formatReviewCommentBody(finding: ReviewFindingSummary): string {
    const ruleId = escapeBackticks(finding.ruleId ?? 'unknown-rule');
    const scanner = escapeMarkdown(finding.category ?? 'unknown-scanner');
    const severity = finding.severity.toUpperCase();
    const lines = [
      `**:warning: ${severity}** | \`${ruleId}\` | ${scanner}`,
      '',
      escapeMarkdown(finding.message),
    ];

    if (finding.snippet) {
      const snippet = safeTruncate(finding.snippet, MAX_REVIEW_SNIPPET_LENGTH).replace(
        /```/g,
        '``\\`',
      );
      lines.push(
        '',
        '<details><summary>Code snippet</summary>',
        '',
        '```',
        snippet,
        '```',
        '',
        '</details>',
      );
    }

    return safeTruncate(lines.join('\n'), MAX_REVIEW_COMMENT_LENGTH);
  }

  private buildReviewBody(params: {
    summary: ScanSummary;
    inlineCount: number;
    skippedFindings: ReviewFindingSummary[];
    cappedFindingsCount: number;
  }): string {
    const lines = [
      '## ShipSec Security Review',
      '',
      '| Severity | Count |',
      '|----------|-------|',
      `| Critical | ${params.summary.critical} |`,
      `| High | ${params.summary.high} |`,
      `| Medium | ${params.summary.medium} |`,
      `| Low | ${params.summary.low} |`,
      `| Info | ${params.summary.info} |`,
      '',
      `**${params.inlineCount}** inline comments posted.`,
    ];

    if (params.cappedFindingsCount > 0) {
      lines.push(
        `**${params.cappedFindingsCount}** additional inline-eligible findings not posted (50 comment limit).`,
      );
    }

    if (params.skippedFindings.length > 0) {
      lines.push('', `**${params.skippedFindings.length}** findings outside the diff:`, '');

      const listed = params.skippedFindings.slice(0, MAX_REVIEW_SKIPPED_IN_BODY);
      for (const finding of listed) {
        const file = escapeBackticks(finding.file);
        const message = escapeMarkdown(finding.message);
        lines.push(
          `- \`${file}:${finding.line}\` - **${finding.severity.toUpperCase()}** ${message}`,
        );
      }

      const remaining = params.skippedFindings.length - listed.length;
      if (remaining > 0) {
        lines.push(`- ... and ${remaining} more`);
      }
    }

    return safeTruncate(lines.join('\n'), MAX_REVIEW_BODY_LENGTH);
  }

  /**
   * Extract findings data from workflow result outputs.
   * Walks all node outputs looking for normalized findings data,
   * check run IDs, and PR comment IDs. Merges findings from
   * multiple normalize nodes (e.g. trufflehog + opengrep).
   */
  private extractScanDataFromResult(result: unknown): Partial<NewGitHubScanResultRecord> {
    const data: Partial<NewGitHubScanResultRecord> = {};

    // The workflow result is { outputs: Record<string, unknown>, success: boolean }
    const resultObj = result as Record<string, unknown> | null;
    const outputs = (resultObj?.outputs ?? {}) as Record<string, unknown>;

    const mergedSummary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const allFindings: Record<string, unknown>[] = [];
    let totalFindingCount = 0;

    for (const nodeOutput of Object.values(outputs)) {
      if (!nodeOutput || typeof nodeOutput !== 'object') continue;
      const output = nodeOutput as Record<string, unknown>;

      // Only collect findings from normalize nodes (identified by having a
      // summary object with severity counts). Raw scanner nodes also expose
      // findings/findingCount, but including them would double-count.
      const isNormalizeNode =
        output.summary &&
        typeof output.summary === 'object' &&
        'critical' in (output.summary as object);

      if (isNormalizeNode) {
        const summary = output.summary as Record<string, number>;
        mergedSummary.critical += summary.critical ?? 0;
        mergedSummary.high += summary.high ?? 0;
        mergedSummary.medium += summary.medium ?? 0;
        mergedSummary.low += summary.low ?? 0;
        mergedSummary.info += summary.info ?? 0;

        if (typeof output.findingCount === 'number') {
          totalFindingCount += output.findingCount;
        }

        if (Array.isArray(output.findings)) {
          for (const finding of output.findings) {
            if (finding && typeof finding === 'object') {
              allFindings.push(finding as Record<string, unknown>);
            }
          }
        }
      }

      // Look for check run ID (from github.check.create/update)
      if (typeof output.checkRunId === 'number') {
        data.checkRunId = output.checkRunId;
      }

      // Look for PR comment ID (from github.pr.comment) — last valid wins
      if (typeof output.commentId === 'number') {
        data.prCommentId = output.commentId;
      }
    }

    if (totalFindingCount > 0 || allFindings.length > 0) {
      data.summary = mergedSummary;
      data.findingsCount = Math.max(totalFindingCount, allFindings.length);

      // Map normalized findings to the scan result schema
      data.findings = allFindings.map((f) => ({
        id: String(f.finding_hash ?? f.id ?? crypto.randomUUID()),
        type: String(f.scanner ?? f.type ?? 'unknown'),
        severity: this.normalizeSeverity(f.severity),
        file: String(f.file ?? ''),
        line: typeof f.line === 'number' ? f.line : undefined,
        endLine: typeof f.endLine === 'number' ? f.endLine : undefined,
        message: this.firstNonEmptyString(f.description, f.title, f.message),
        snippet: typeof f.snippet === 'string' ? f.snippet : undefined,
        ruleId: typeof f.rule_id === 'string' ? f.rule_id : undefined,
        category: typeof f.scanner === 'string' ? f.scanner : undefined,
      }));
    }

    return data;
  }

  private normalizeSeverity(value: unknown): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    const valid = ['critical', 'high', 'medium', 'low', 'info'];
    const s = String(value).toLowerCase();
    return valid.includes(s) ? (s as 'critical' | 'high' | 'medium' | 'low' | 'info') : 'info';
  }

  private firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      if (value.trim().length === 0) continue;
      return value;
    }
    return '';
  }
}
