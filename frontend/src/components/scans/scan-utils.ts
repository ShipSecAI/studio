import { Badge } from '@/components/ui/badge';
import type { GitHubScanResult, ScanFinding } from '@/store/githubStore';
import { Check, X, Clock, AlertCircle, Loader2 } from 'lucide-react';
import React from 'react';

// ── Status rendering ──────────────────────────────────────────────

export const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500',
  running: 'bg-blue-500',
  success: 'bg-green-500',
  failure: 'bg-red-500',
  error: 'bg-red-700',
};

export const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: React.createElement(Clock, { className: 'h-4 w-4' }),
  running: React.createElement(Loader2, { className: 'h-4 w-4 animate-spin' }),
  success: React.createElement(Check, { className: 'h-4 w-4' }),
  failure: React.createElement(X, { className: 'h-4 w-4' }),
  error: React.createElement(AlertCircle, { className: 'h-4 w-4' }),
};

// ── Severity rendering ────────────────────────────────────────────

export const SEVERITY_CONFIG: Record<
  string,
  { label: string; badgeClass: string; bgClass: string; textClass: string; color: string }
> = {
  critical: {
    label: 'Critical',
    badgeClass: 'bg-red-600 text-white',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    textClass: 'text-red-700 dark:text-red-400',
    color: '#dc2626',
  },
  high: {
    label: 'High',
    badgeClass: 'bg-orange-600 text-white',
    bgClass: 'bg-orange-50 dark:bg-orange-950/30',
    textClass: 'text-orange-700 dark:text-orange-400',
    color: '#ea580c',
  },
  medium: {
    label: 'Medium',
    badgeClass: 'bg-yellow-600 text-white',
    bgClass: 'bg-yellow-50 dark:bg-yellow-950/30',
    textClass: 'text-yellow-700 dark:text-yellow-400',
    color: '#ca8a04',
  },
  low: {
    label: 'Low',
    badgeClass: 'bg-blue-600 text-white',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    textClass: 'text-blue-700 dark:text-blue-400',
    color: '#2563eb',
  },
  info: {
    label: 'Info',
    badgeClass: 'bg-gray-600 text-white',
    bgClass: 'bg-gray-50 dark:bg-gray-950/30',
    textClass: 'text-gray-700 dark:text-gray-400',
    color: '#4b5563',
  },
};

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

// ── Source mapping ───────────────────────────────────────────────

export type ScanSourceKind = 'pr' | 'push' | 'manual' | 'schedule';

export interface ScanSourceMeta {
  kind: ScanSourceKind;
  label: string;
  detail: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
}

export interface ScanFailureGuidance {
  reason: string;
  suggestion: string;
}

export function getScanSourceMeta(scan: GitHubScanResult): ScanSourceMeta {
  const isSchedule = scan.sourceType === 'schedule' || scan.triggerType === 'schedule';
  if (isSchedule) {
    return {
      kind: 'schedule',
      label: 'Scheduled',
      detail: scan.scheduleName ?? scan.triggerLabel ?? null,
      scheduleId: scan.scheduleId ?? scan.triggerSource ?? null,
      scheduleName: scan.scheduleName ?? scan.triggerLabel ?? null,
    };
  }

  if (scan.sourceType === 'pr') {
    return {
      kind: 'pr',
      label: 'PR',
      detail: scan.prNumber != null ? `#${scan.prNumber}` : null,
      scheduleId: null,
      scheduleName: null,
    };
  }

  if (scan.sourceType === 'push') {
    return {
      kind: 'push',
      label: 'Push',
      detail: scan.branch ?? null,
      scheduleId: null,
      scheduleName: null,
    };
  }

  return {
    kind: 'manual',
    label: 'Manual',
    detail: null,
    scheduleId: null,
    scheduleName: null,
  };
}

export function getScanFailureGuidance(scan: GitHubScanResult): ScanFailureGuidance {
  const reason = scan.errorMessage?.trim() || 'Execution failed before completion.';
  const normalized = reason.toLowerCase();

  if (
    normalized.includes('pr context') ||
    normalized.includes('prnumber') ||
    normalized.includes('pull request number')
  ) {
    return {
      reason,
      suggestion: 'Run from a PR trigger rule, or pick a workflow that does not require PR inputs.',
    };
  }

  if (
    normalized.includes('permission denied') ||
    normalized.includes('insufficient permission') ||
    normalized.includes('write permission')
  ) {
    return {
      reason,
      suggestion: 'Update GitHub App permissions for pull requests/comments, then run again.',
    };
  }

  if (normalized.includes('rate limit')) {
    return {
      reason,
      suggestion: 'Wait for GitHub rate limits to reset, then retry the run.',
    };
  }

  return {
    reason,
    suggestion: 'Open run details to inspect failed steps and retry after fixing the root cause.',
  };
}

// ── Time formatting ───────────────────────────────────────────────

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function formatExactTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt);
  const end = new Date(completedAt);
  const diffMs = end.getTime() - start.getTime();

  if (diffMs < 1000) return '<1s';
  if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;
  if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.round((diffMs % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }

  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.round((diffMs % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ── Summary badges component ──────────────────────────────────────

export function SummaryBadges({ summary }: { summary: GitHubScanResult['summary'] }) {
  const items = [
    { label: 'C', count: summary.critical, color: 'bg-red-600' },
    { label: 'H', count: summary.high, color: 'bg-orange-500' },
    { label: 'M', count: summary.medium, color: 'bg-yellow-500' },
    { label: 'L', count: summary.low, color: 'bg-blue-500' },
  ].filter((item) => item.count > 0);

  if (items.length === 0) {
    return React.createElement(
      'span',
      { className: 'text-muted-foreground text-sm' },
      'No findings',
    );
  }

  return React.createElement(
    'div',
    { className: 'flex gap-1' },
    items.map((item) =>
      React.createElement(
        Badge,
        {
          key: item.label,
          variant: 'outline' as const,
          className: `${item.color} text-white border-none text-xs px-1.5`,
        },
        `${item.label}:${item.count}`,
      ),
    ),
  );
}

// ── Export helpers ─────────────────────────────────────────────────

function formatDateForFilename(): string {
  return new Date().toISOString().split('T')[0];
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToJson(scan: GitHubScanResult, repoName: string): void {
  const sanitizedRepoName = sanitizeFilename(repoName);
  const date = formatDateForFilename();
  const filename = `scan-${sanitizedRepoName}-${date}.json`;
  const content = JSON.stringify(scan, null, 2);
  downloadFile(content, filename, 'application/json');
}

export function exportToCsv(scan: GitHubScanResult, repoName: string): void {
  const sanitizedRepoName = sanitizeFilename(repoName);
  const date = formatDateForFilename();
  const filename = `scan-${sanitizedRepoName}-${date}.csv`;

  const findings = scan.findings ?? [];
  const headers = ['severity', 'type', 'file', 'line', 'message'];

  const rows = findings.map((finding) => {
    const escapeField = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [
      escapeField(finding.severity),
      escapeField(finding.type),
      escapeField(finding.file),
      escapeField(finding.line),
      escapeField(finding.message),
    ].join(',');
  });

  const content = [headers.join(','), ...rows].join('\n');
  downloadFile(content, filename, 'text/csv');
}

// ── Grouping utility ──────────────────────────────────────────────

export function groupFindingsBySeverity(findings: ScanFinding[]): Record<string, ScanFinding[]> {
  return SEVERITY_ORDER.reduce(
    (acc, severity) => {
      acc[severity] = findings.filter((f) => f.severity === severity);
      return acc;
    },
    {} as Record<string, ScanFinding[]>,
  );
}
