import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileCode2,
  Filter,
  Link2,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
  X,
} from 'lucide-react';
import {
  api,
  type SecurityFinding,
  type SecurityFindingLink,
  type SecurityThreatStory,
} from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCustomHeader, useLayoutControls } from '@/components/layout/PageHeaderContext';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { MarkdownView } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';

/* ---------- constants ---------- */

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
};

const severityConfig: Record<
  string,
  {
    bg: string;
    text: string;
    dot: string;
    badge: string;
    pill: string;
    ring: string;
    barBg: string;
  }
> = {
  critical: {
    bg: 'bg-red-500/8',
    text: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
    badge: 'bg-red-600 text-white border-red-600',
    pill: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/15',
    ring: 'text-red-500',
    barBg: 'bg-red-500',
  },
  high: {
    bg: 'bg-orange-500/8',
    text: 'text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
    badge: 'bg-orange-500 text-white border-orange-500',
    pill: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/15',
    ring: 'text-orange-500',
    barBg: 'bg-orange-500',
  },
  medium: {
    bg: 'bg-amber-400/8',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-400',
    badge:
      'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    pill: 'bg-amber-400/10 text-amber-700 dark:text-amber-400 border-amber-400/15',
    ring: 'text-amber-400',
    barBg: 'bg-amber-400',
  },
  low: {
    bg: 'bg-blue-400/8',
    text: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-400',
    badge:
      'bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    pill: 'bg-blue-400/10 text-blue-600 dark:text-blue-400 border-blue-400/15',
    ring: 'text-blue-400',
    barBg: 'bg-blue-400',
  },
  info: {
    bg: 'bg-slate-300/8',
    text: 'text-slate-500',
    dot: 'bg-slate-400',
    badge:
      'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    pill: 'bg-slate-400/10 text-slate-500 border-slate-400/15',
    ring: 'text-slate-400',
    barBg: 'bg-slate-400',
  },
  unknown: {
    bg: 'bg-slate-300/8',
    text: 'text-slate-500',
    dot: 'bg-slate-400',
    badge:
      'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    pill: 'bg-slate-400/10 text-slate-500 border-slate-400/15',
    ring: 'text-slate-400',
    barBg: 'bg-slate-400',
  },
};

const statusConfig: Record<
  string,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  open: { label: 'Open', icon: AlertTriangle, className: 'text-red-600 dark:text-red-400' },
  fix_pending: {
    label: 'Fix pending',
    icon: Clock3,
    className: 'text-amber-600 dark:text-amber-400',
  },
  resolved: {
    label: 'Resolved',
    icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  false_positive: { label: 'False positive', icon: ShieldCheck, className: 'text-slate-500' },
};

const roleLabels: Record<string, string> = {
  root_cause: 'Root cause',
  attack_vector: 'Attack vector',
  enabler: 'Enabler',
  indicator: 'Indicator',
  evidence: 'Evidence',
  impact: 'Impact',
};

const relationLabels: Record<string, string> = {
  duplicate_of: 'Duplicate of',
  same_root_cause: 'Same root cause',
  enables: 'Enables',
  contradicts: 'Contradicts',
  same_asset: 'Same asset',
  same_control: 'Same control',
  mitigated_by: 'Mitigated by',
  related: 'Related',
};

const assessmentConfig: Record<string, { label: string; className: string }> = {
  actionable: {
    label: 'Actionable',
    className:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  },
  needs_context: {
    label: 'Needs context',
    className:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  },
  accepted_risk: {
    label: 'Accepted risk',
    className:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
  },
  resolved_candidate: {
    label: 'May be fixed',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  },
  not_relevant: {
    label: 'Hidden noise',
    className:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
  },
  false_positive: {
    label: 'False positive',
    className:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
  },
};

/* ---------- helpers ---------- */

function getSeverity(s: string) {
  return severityConfig[s.toLowerCase()] ?? severityConfig.unknown;
}

function formatDate(value?: string | null) {
  if (!value) return 'Unknown';
  const d = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.round(diffMs / (1000 * 60))}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getResolvedStatus(finding: SecurityFinding): string {
  if (finding.lifecycleHint === 'fixed_candidate' || finding.status === 'in_progress')
    return 'fix_pending';
  if (finding.status === 'false_positive') return 'false_positive';
  if (finding.status === 'resolved') return 'resolved';
  return 'open';
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getAssessmentConfig(finding: SecurityFinding) {
  const verdict = finding.latestAssessment?.verdict;
  if (!verdict) return null;
  return (
    assessmentConfig[verdict] ?? {
      label: verdict.replaceAll('_', ' '),
      className: 'border-muted bg-muted text-muted-foreground',
    }
  );
}

function getStackRelevanceValue(finding: SecurityFinding, key: string) {
  const value = finding.latestAssessment?.metadata?.stackRelevance;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

/* ---------- Selection types ---------- */

type Selection =
  | { kind: 'finding'; item: SecurityFinding }
  | { kind: 'story'; item: SecurityThreatStory };

interface FindingReference {
  id: string;
  findingKey: string;
  title?: string | null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectFindingReferences(
  finding: SecurityFinding,
  knownFindings: SecurityFinding[] = [],
): FindingReference[] {
  const refs = new Map<string, FindingReference>();
  const add = (ref?: FindingReference | null) => {
    if (!ref?.id || !ref.findingKey) return;
    refs.set(ref.id, ref);
    refs.set(ref.findingKey, ref);
  };

  add(finding);
  knownFindings.forEach(add);
  finding.relatedLinks.forEach((link) => {
    add(link.fromFinding);
    add(link.toFinding);
    add(link.relatedFinding);
  });

  return [...new Map([...refs.values()].map((ref) => [ref.id, ref])).values()];
}

function collectStoryReferences(story: SecurityThreatStory): FindingReference[] {
  return story.findings.map((finding) => ({
    id: finding.id,
    findingKey: finding.findingKey,
    title: finding.title,
  }));
}

function linkFindingReferences(markdown: string, refs: FindingReference[]) {
  const tokens = refs
    .flatMap((ref) => [
      { text: ref.findingKey, id: ref.id, title: ref.title },
      { text: ref.id, id: ref.id, title: ref.title },
    ])
    .filter((token) => token.text.length >= 8)
    .sort((a, b) => b.text.length - a.text.length);

  if (tokens.length === 0) return markdown;

  const linkSegment = (segment: string) => {
    let linked = segment;
    for (const token of tokens) {
      const href = `/findings/${token.id}`;
      const label = token.title ? `${token.text}` : token.text;
      linked = linked.replace(
        new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(token.text)})(?![A-Za-z0-9_])`, 'g'),
        (_match, prefix: string) => `${prefix}[${label}](${href})`,
      );
    }
    return linked;
  };

  const protectedPattern = /```[\s\S]*?```|`[^`\n]+`|\[[^\]]+\]\([^)]+\)/g;
  let output = '';
  let lastIndex = 0;
  for (const match of markdown.matchAll(protectedPattern)) {
    const index = match.index ?? 0;
    output += linkSegment(markdown.slice(lastIndex, index));
    output += match[0];
    lastIndex = index + match[0].length;
  }
  output += linkSegment(markdown.slice(lastIndex));
  return output;
}

const markdownClassName =
  'prose prose-sm dark:prose-invert max-w-none text-foreground/80 prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-foreground prose-p:my-2 prose-p:leading-relaxed prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-a:font-medium prose-a:text-primary prose-table:text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left';

function MarkdownBlock({ content, className }: { content: string; className?: string }) {
  return <MarkdownView content={content} className={cn(markdownClassName, className)} />;
}

function storyRoleOrder(role: string) {
  const order: Record<string, number> = {
    attack_vector: 0,
    root_cause: 1,
    enabler: 2,
    evidence: 3,
    indicator: 4,
    impact: 5,
  };
  return order[role] ?? 9;
}

function getStoryAttackPathItems(story: SecurityThreatStory) {
  return [...story.findings]
    .sort((a, b) => storyRoleOrder(a.role) - storyRoleOrder(b.role))
    .slice(0, 6);
}

/* ---------- small components ---------- */

function SeverityBadge({ severity }: { severity: string }) {
  const s = getSeverity(severity);
  return (
    <Badge variant="outline" className={cn('capitalize text-[11px] font-semibold', s.badge)}>
      {severity}
    </Badge>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const s = getSeverity(severity);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none',
        s.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {severity}
    </span>
  );
}

function SeverityDot({ severity, className }: { severity: string; className?: string }) {
  const s = getSeverity(severity);
  return <span className={cn('inline-block h-2 w-2 rounded-full', s.dot, className)} />;
}

function StatusIndicator({ finding }: { finding: SecurityFinding }) {
  const status = getResolvedStatus(finding);
  const config = statusConfig[status] ?? statusConfig.open;
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', config.className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

function AssessmentBadge({ finding }: { finding: SecurityFinding }) {
  const config = getAssessmentConfig(finding);
  if (!config) {
    return (
      <Badge variant="outline" className="text-[11px] text-muted-foreground">
        Unassessed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium', config.className)}>
      {config.label}
    </Badge>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

/* ---------- Severity ring (mini donut) ---------- */

function SeverityRing({
  counts,
  total,
  size = 56,
}: {
  counts: { severity: string; count: number }[];
  total: number;
  size?: number;
}) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/40"
        />
        {counts.map(({ severity, count }) => {
          const s = getSeverity(severity);
          const fraction = total > 0 ? count / total : 0;
          const dashLength = fraction * circumference;
          const dashOffset = -offset;
          offset += dashLength;
          return (
            <circle
              key={severity}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              className={s.ring}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold tabular-nums">{total}</span>
      </div>
    </div>
  );
}

/* ---------- Severity stat pill ---------- */

function SeverityStatPill({ severity, count }: { severity: string; count: number }) {
  const s = getSeverity(severity);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className={cn('h-2.5 w-2.5 rounded-full', s.dot)} />
      <span className="text-lg font-bold tabular-nums">{count}</span>
      <span className="text-xs capitalize text-muted-foreground">{severity}</span>
    </div>
  );
}

/* ---------- List items ---------- */

function StoryListItem({
  story,
  active,
  onClick,
  variant,
}: {
  story: SecurityThreatStory;
  active: boolean;
  onClick: () => void;
  variant: number;
}) {
  const s = getSeverity(story.severity);

  switch (variant) {
    case 0:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
            active ? 'border-primary/20 bg-primary/[0.06]' : 'border-transparent hover:bg-muted/30',
          )}
        >
          <span className={cn('absolute left-0 top-2 h-8 w-0.5 rounded-r-full', s.barBg)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1 pl-1">
            <h3
              className={cn(
                'line-clamp-2 text-[13px] font-semibold leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {story.title}
            </h3>
            {story.summary && (
              <p className="line-clamp-1 text-[11px] text-muted-foreground/60">{story.summary}</p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium',
                  s.bg,
                  s.text,
                )}
              >
                {story.severity}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/40">
                {story.storyKey}
              </span>
              <span className="ml-auto">{formatDate(story.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    case 1:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all',
            active ? 'border-primary/20 bg-primary/[0.04]' : 'border-transparent hover:bg-muted/30',
          )}
        >
          <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dot)} />
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                'line-clamp-1 text-[13px] font-medium leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {story.title}
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
              <span className="font-mono text-[9px]">{story.storyKey}</span>
              <span>·</span>
              <span>{formatDate(story.lastSeenAt)}</span>
            </div>
          </div>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {story.findings.length}
          </span>
        </button>
      );

    case 2:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full flex-col gap-2 rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition-all',
            active
              ? 'border-primary/30 ring-1 ring-primary/20'
              : 'border-border/60 hover:border-border hover:shadow',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <h3
              className={cn(
                'min-w-0 flex-1 line-clamp-2 text-[13px] font-semibold leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {story.title}
            </h3>
            <SeverityPill severity={story.severity} />
          </div>
          {story.summary && (
            <p className="line-clamp-1 text-[11px] text-muted-foreground/60">{story.summary}</p>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="font-mono text-[9px] text-muted-foreground/40">{story.storyKey}</span>
            <span>{formatDate(story.lastSeenAt)}</span>
          </div>
        </button>
      );

    case 3:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-all',
            active
              ? 'border-l-primary bg-primary/[0.03]'
              : 'border-l-transparent hover:bg-muted/20',
            s.barBg,
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.dot)} />
              <h3
                className={cn(
                  'line-clamp-1 text-[12px] font-medium leading-snug',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {story.title}
              </h3>
            </div>
            <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-[10px] text-muted-foreground/50">
              <span className="font-mono">{story.storyKey}</span>
              <span>·</span>
              <span className="tabular-nums">{story.findings.length} findings</span>
              <span>·</span>
              <span>{formatDate(story.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    case 4:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all',
            active
              ? 'border-primary/20 bg-primary/[0.06]'
              : 'border-transparent hover:border-border/60 hover:bg-muted/20',
          )}
        >
          <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', s.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none',
                  s.bg,
                  s.text,
                )}
              >
                {story.severity}
              </span>
              <h3
                className={cn(
                  'line-clamp-2 text-[12px] font-medium leading-snug',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {story.title}
              </h3>
            </div>
            {story.summary && (
              <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/60">
                {story.summary}
              </p>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/40">
              <span>{story.storyKey}</span>
              <span className="text-muted-foreground/20">·</span>
              <span className="tabular-nums">{story.findings.length} findings</span>
              <span className="text-muted-foreground/20">·</span>
              <span>{formatDate(story.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    default:
      return null;
  }
}

function FindingListItem({
  finding,
  active,
  onClick,
  variant,
}: {
  finding: SecurityFinding;
  active: boolean;
  onClick: () => void;
  variant: number;
}) {
  const s = getSeverity(finding.severity);
  const assetLine = finding.asset?.displayName ?? finding.file;

  switch (variant) {
    case 0:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
            active ? 'border-primary/20 bg-primary/[0.06]' : 'border-transparent hover:bg-muted/30',
          )}
        >
          <span className={cn('absolute left-0 top-2 h-8 w-0.5 rounded-r-full', s.barBg)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1 pl-1">
            <h3
              className={cn(
                'line-clamp-2 text-[13px] font-semibold leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {finding.title ?? finding.findingKey}
            </h3>
            {assetLine && (
              <p className="line-clamp-1 text-[10px] font-mono text-muted-foreground/50">
                {assetLine}
              </p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium',
                  s.bg,
                  s.text,
                )}
              >
                {finding.severity}
              </span>
              <StatusIndicator finding={finding} />
              <span className="ml-auto">{formatDate(finding.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    case 1:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all',
            active ? 'border-primary/20 bg-primary/[0.04]' : 'border-transparent hover:bg-muted/30',
          )}
        >
          <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dot)} />
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                'line-clamp-1 text-[13px] font-medium leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {finding.title ?? finding.findingKey}
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
              <StatusIndicator finding={finding} />
              <span>·</span>
              <span>{formatDate(finding.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    case 2:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full flex-col gap-2 rounded-xl border bg-card px-3 py-3 text-left shadow-sm transition-all',
            active
              ? 'border-primary/30 ring-1 ring-primary/20'
              : 'border-border/60 hover:border-border hover:shadow',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <h3
              className={cn(
                'min-w-0 flex-1 line-clamp-2 text-[13px] font-semibold leading-snug',
                active ? 'text-foreground' : 'text-foreground/80',
              )}
            >
              {finding.title ?? finding.findingKey}
            </h3>
            <SeverityPill severity={finding.severity} />
          </div>
          {assetLine && (
            <p className="line-clamp-1 text-[10px] font-mono text-muted-foreground/50">
              {assetLine}
            </p>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <StatusIndicator finding={finding} />
            <span>{formatDate(finding.lastSeenAt)}</span>
          </div>
        </button>
      );

    case 3:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-all',
            active
              ? 'border-l-primary bg-primary/[0.03]'
              : 'border-l-transparent hover:bg-muted/20',
            s.barBg,
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.dot)} />
              <h3
                className={cn(
                  'line-clamp-1 text-[12px] font-medium leading-snug',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {finding.title ?? finding.findingKey}
              </h3>
            </div>
            <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-[10px] text-muted-foreground/50">
              <StatusIndicator finding={finding} />
              <span>·</span>
              <span>{formatDate(finding.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    case 4:
      return (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'group relative flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all',
            active
              ? 'border-primary/20 bg-primary/[0.06]'
              : 'border-transparent hover:border-border/60 hover:bg-muted/20',
          )}
        >
          <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', s.dot)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <span
                className={cn(
                  'mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none',
                  s.bg,
                  s.text,
                )}
              >
                {finding.severity}
              </span>
              <h3
                className={cn(
                  'line-clamp-2 text-[12px] font-medium leading-snug',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {finding.title ?? finding.findingKey}
              </h3>
            </div>
            {assetLine && (
              <p className="mt-0.5 line-clamp-1 text-[10px] font-mono text-muted-foreground/50">
                {assetLine}
              </p>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <StatusIndicator finding={finding} />
              <span className="text-muted-foreground/20">·</span>
              <span>{formatDate(finding.lastSeenAt)}</span>
            </div>
          </div>
        </button>
      );

    default:
      return null;
  }
}

/* ---------- Detail: Finding ---------- */

function FindingDetailPanel({
  finding,
  knownFindings,
}: {
  finding: SecurityFinding;
  knownFindings: SecurityFinding[];
}) {
  const [tab, setTab] = useState<'summary' | 'evidence' | 'links'>('summary');
  const linkedAssessmentMarkdown = useMemo(() => {
    if (!finding.latestAssessment?.reasoningMarkdown) return '';
    return linkFindingReferences(
      finding.latestAssessment.reasoningMarkdown,
      collectFindingReferences(finding, knownFindings),
    );
  }, [finding, knownFindings]);

  const observations = uniqueBy(finding.observations, (o) =>
    [
      o.status ?? '',
      o.title,
      o.observedAt,
      o.runId ?? '',
      o.reviewMode ?? '',
      o.lifecycleHint ?? '',
      o.prNumber ?? '',
    ].join('|'),
  );
  const evidenceItems = uniqueBy(
    finding.evidence,
    (e) => `${e.summary ?? e.artifactUri}|${e.capturedAt}`,
  );
  const referenceContext = useMemo(
    () => collectFindingReferences(finding, knownFindings),
    [finding, knownFindings],
  );
  const linkMarkdown = useCallback(
    (content: string) => linkFindingReferences(content, referenceContext),
    [referenceContext],
  );

  const detailTabs = [
    { key: 'summary' as const, label: 'Summary' },
    {
      key: 'evidence' as const,
      label: 'Evidence',
      count: observations.length + evidenceItems.length,
    },
    { key: 'links' as const, label: 'Linked', count: finding.relatedLinks.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b px-6 py-5">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              getSeverity(finding.severity).bg,
            )}
          >
            <SeverityDot severity={finding.severity} className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight tracking-tight">
              {finding.title ?? finding.findingKey}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <StatusIndicator finding={finding} />
              <AssessmentBadge finding={finding} />
            </div>
          </div>
          {finding.workflowId && finding.runId && (
            <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" asChild>
              <Link to={`/workflows/${finding.workflowId}/runs/${finding.runId}`}>
                <ExternalLink className="mr-1.5 h-3 w-3" />
                Agent run
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 border-b px-6">
        <nav className="flex gap-1">
          {detailTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'border-b-2 px-3.5 pb-3 pt-3.5 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {'count' in t && t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'summary' && (
          <div className="flex gap-6">
            {/* Main content */}
            <div className="min-w-0 flex-1 px-6 py-6 space-y-6">
              {finding.latestAssessment && (
                <section className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SectionLabel className="mb-0">Agent assessment</SectionLabel>
                    <AssessmentBadge finding={finding} />
                    <Badge variant="outline" className="capitalize text-[11px]">
                      {finding.latestAssessment.importance}
                    </Badge>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {Math.round(finding.latestAssessment.confidence * 100)}% confidence
                    </span>
                  </div>
                  <MarkdownBlock content={linkedAssessmentMarkdown} className="mt-3" />
                  <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
                    {[
                      ['Wiki', getStackRelevanceValue(finding, 'seenInWiki')],
                      ['Inventory', getStackRelevanceValue(finding, 'seenInInventory')],
                      ['Runtime path', getStackRelevanceValue(finding, 'activeRuntimePath')],
                      ['Customer path', getStackRelevanceValue(finding, 'customerImpactPath')],
                      ['Public exposure', getStackRelevanceValue(finding, 'publicExposure')],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border bg-background px-2.5 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {label}
                        </div>
                        <div className="mt-0.5 font-medium">
                          {value === undefined ? 'Unknown' : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {finding.latestAssessment.wikiRefs.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {finding.latestAssessment.wikiRefs.map((ref) => (
                        <Badge key={ref} variant="secondary" className="text-[10px]">
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {finding.description && (
                <section>
                  <SectionLabel>Description</SectionLabel>
                  <MarkdownBlock content={linkMarkdown(finding.description)} />
                </section>
              )}

              {finding.impact && (
                <section>
                  <SectionLabel>Impact</SectionLabel>
                  <MarkdownBlock content={linkMarkdown(finding.impact)} />
                </section>
              )}

              {finding.fix && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                  <SectionLabel className="text-emerald-700 dark:text-emerald-400">
                    Recommended fix
                  </SectionLabel>
                  <MarkdownBlock
                    content={linkMarkdown(finding.fix)}
                    className="text-emerald-900 dark:text-emerald-200"
                  />
                  {finding.verification && (
                    <div className="mt-3 rounded-lg bg-emerald-100/70 px-3 py-2 dark:bg-emerald-950/50">
                      <SectionLabel className="mb-1 text-emerald-700 dark:text-emerald-400">
                        Validation
                      </SectionLabel>
                      <MarkdownBlock
                        content={linkMarkdown(finding.verification)}
                        className="text-xs text-emerald-800 dark:text-emerald-300"
                      />
                    </div>
                  )}
                </div>
              )}

              {finding.threatRefs.length > 0 && (
                <section>
                  <SectionLabel>Threat references</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {finding.threatRefs.map((ref) => (
                      <Badge key={ref} variant="secondary" className="text-xs">
                        <Target className="mr-1 h-3 w-3" />
                        {ref}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right sidebar - More context */}
            <aside className="hidden w-64 shrink-0 border-l bg-muted/10 px-5 py-6 xl:block">
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                More context
              </h4>
              <div className="space-y-4">
                <MetaField label="Finding key" value={finding.findingKey} />
                <MetaField label="Source" value={finding.sourceKind} />
                <MetaField label="Repository" value={finding.repository ?? 'Unknown'} />
                {finding.branch && <MetaField label="Branch" value={finding.branch} />}
                {finding.file && (
                  <MetaField
                    label="File"
                    value={`${finding.file}${finding.line ? `:${finding.line}` : ''}`}
                  />
                )}
                <MetaField label="First seen" value={formatDate(finding.firstSeenAt)} />
                <MetaField label="Last updated" value={formatDate(finding.lastSeenAt)} />
                {finding.relatedLinks.length > 0 && (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Linked findings
                    </dt>
                    <dd className="mt-0.5 flex items-center gap-1 text-sm">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                      {finding.relatedLinks.length}
                    </dd>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}

        {tab === 'evidence' && (
          <div className="px-6 py-6 space-y-4">
            {observations.length === 0 && evidenceItems.length === 0 ? (
              <EmptyState icon={Search} message="No evidence collected yet" />
            ) : (
              <>
                {observations.length > 0 && (
                  <div>
                    <SectionLabel>Observations</SectionLabel>
                    <div className="space-y-2">
                      {observations.map((obs) => (
                        <div key={obs.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {obs.reviewMode ?? 'run'}
                            </Badge>
                            {obs.lifecycleHint && (
                              <Badge variant="outline" className="text-[10px]">
                                {obs.lifecycleHint}
                              </Badge>
                            )}
                            {obs.prNumber && (
                              <Badge variant="outline" className="text-[10px]">
                                PR {obs.prNumber}
                              </Badge>
                            )}
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              {formatDate(obs.observedAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium">{obs.title}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {evidenceItems.length > 0 && (
                  <div>
                    <SectionLabel>Artifacts</SectionLabel>
                    <div className="space-y-2">
                      {evidenceItems.map((ev) => (
                        <div key={ev.id} className="rounded-lg border bg-muted/30 p-3">
                          <MarkdownBlock
                            content={linkMarkdown(ev.summary ?? ev.artifactUri)}
                            className="text-sm"
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatDate(ev.capturedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'links' && (
          <div className="px-6 py-6 space-y-3">
            {finding.relatedLinks.length === 0 ? (
              <EmptyState icon={Link2} message="No linked findings" />
            ) : (
              finding.relatedLinks.map((link) => <LinkedFindingCard key={link.id} link={link} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Detail: Threat Story ---------- */

function StoryDetailPanel({ story }: { story: SecurityThreatStory }) {
  const [tab, setTab] = useState<'summary' | 'findings' | 'evidence'>('summary');
  const storyStatus =
    story.status === 'resolved'
      ? statusConfig.resolved
      : story.status === 'in_progress'
        ? statusConfig.fix_pending
        : statusConfig.open;
  const StatusIcon = storyStatus.icon;
  const storyReferences = useMemo(() => collectStoryReferences(story), [story]);
  const linkStoryMarkdown = useCallback(
    (content: string) => linkFindingReferences(content, storyReferences),
    [storyReferences],
  );
  const attackPathItems = useMemo(() => getStoryAttackPathItems(story), [story]);

  const storyTabs = [
    { key: 'summary' as const, label: 'Summary' },
    { key: 'findings' as const, label: 'Findings', count: story.findings.length },
    { key: 'evidence' as const, label: 'Evidence', count: story.evidenceRefs.length },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Header */}
      <div className="shrink-0 border-b px-6 py-5">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              getSeverity(story.severity).bg,
            )}
          >
            <SeverityDot severity={story.severity} className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight tracking-tight">{story.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={story.severity} />
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium',
                  storyStatus.className,
                )}
              >
                <StatusIcon className="h-3.5 w-3.5" />
                {storyStatus.label}
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                {story.storyKey}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="shrink-0 border-b px-6">
        <nav className="flex gap-1">
          {storyTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'border-b-2 px-3.5 pb-3 pt-3.5 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {'count' in t && t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'summary' && (
          <div className="flex gap-6">
            {/* Main content */}
            <div className="min-w-0 flex-1 space-y-6 px-6 py-6">
              {story.summary && (
                <section>
                  <MarkdownBlock
                    content={linkStoryMarkdown(story.summary)}
                    className="text-muted-foreground"
                  />
                </section>
              )}

              {story.impact && (
                <section>
                  <SectionLabel>Impact</SectionLabel>
                  <MarkdownBlock content={linkStoryMarkdown(story.impact)} />
                </section>
              )}

              {attackPathItems.length > 0 && (
                <section>
                  <SectionLabel>Attack path</SectionLabel>
                  <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border bg-card p-2">
                    {attackPathItems.map((finding, index) => {
                      const fs = getSeverity(finding.severity);
                      return (
                        <div
                          key={finding.id}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/30',
                            'border-border/60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
                              fs.bg,
                              fs.text,
                            )}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {roleLabels[finding.role] ?? finding.role}
                              </span>
                              {finding.title && (
                                <Link
                                  to={`/findings/${finding.id}`}
                                  className="line-clamp-1 text-[12px] font-medium hover:text-primary"
                                >
                                  {finding.title}
                                </Link>
                              )}
                            </div>
                            {finding.rationale && (
                              <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/60">
                                {finding.rationale}
                              </p>
                            )}
                            <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/40">
                              {finding.findingKey}
                            </p>
                          </div>
                          <Link
                            to={`/findings/${finding.id}`}
                            className="shrink-0 self-center rounded p-1 text-muted-foreground/30 hover:text-primary"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                  {story.attackPath && (
                    <MarkdownBlock
                      content={linkStoryMarkdown(story.attackPath)}
                      className="mt-4 rounded-lg bg-muted/40 px-4 py-3 text-sm"
                    />
                  )}
                </section>
              )}

              {story.recommendedAction && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                  <SectionLabel className="text-emerald-700 dark:text-emerald-400">
                    Recommended fix
                  </SectionLabel>
                  <MarkdownBlock
                    content={linkStoryMarkdown(story.recommendedAction)}
                    className="text-emerald-900 dark:text-emerald-200"
                  />
                </div>
              )}
            </div>

            {/* Right sidebar - More context */}
            <aside className="hidden w-64 shrink-0 border-l bg-muted/10 px-5 py-6 xl:block">
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                More context
              </h4>
              <div className="space-y-4">
                <MetaField label="Confidence" value={`${Math.round(story.confidence * 100)}%`} />
                <MetaField label="Findings" value={`${story.findings.length}`} />
                <MetaField label="First seen" value={formatDate(story.firstSeenAt)} />
                <MetaField label="Last seen" value={formatDate(story.lastSeenAt)} />
                {story.createdBy && <MetaField label="Created by" value={story.createdBy} />}
                {story.affectedAssetRefs.length > 0 && (
                  <div>
                    <SectionLabel>Affected assets</SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {story.affectedAssetRefs.map((asset) => (
                        <Badge key={asset} variant="secondary" className="text-[10px]">
                          {asset}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}

        {tab === 'findings' && (
          <div className="px-6 py-6">
            <div className="divide-y rounded-lg border bg-card">
              {story.findings.map((finding) => (
                <StoryEvidenceCard
                  key={finding.id}
                  finding={finding}
                  renderMarkdown={linkStoryMarkdown}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'evidence' && (
          <div className="px-6 py-6 space-y-4">
            {story.evidenceRefs.length === 0 ? (
              <EmptyState icon={Search} message="No evidence references" />
            ) : (
              <div className="space-y-2">
                {story.evidenceRefs.map((ref) => (
                  <div key={ref} className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-sm font-medium">{ref}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Linked Finding Card ---------- */

function LinkedFindingCard({ link }: { link: SecurityFindingLink }) {
  const label = relationLabels[link.relationshipType] ?? link.relationshipType.replaceAll('_', ' ');
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            link.direction === 'outgoing'
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
          )}
        >
          {link.direction === 'outgoing' ? (
            <ArrowRight className="h-2.5 w-2.5" />
          ) : (
            <ArrowRight className="h-2.5 w-2.5 rotate-180" />
          )}
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {Math.round(link.confidence * 100)}% confidence
        </span>
      </div>
      <div className="mt-2 flex items-start gap-2">
        <SeverityDot severity={link.relatedFinding.severity} className="mt-1.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">
            {link.relatedFinding.title ?? link.relatedFinding.findingKey}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{link.rationale}</p>
        </div>
      </div>
    </div>
  );
}

function StoryEvidenceCard({
  finding,
  renderMarkdown,
}: {
  finding: SecurityThreatStory['findings'][number];
  renderMarkdown: (content: string) => string;
}) {
  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
      <div className="flex items-center gap-2 sm:block">
        <div className="flex items-center gap-2">
          <SeverityDot severity={finding.severity} />
          <span className="text-xs font-medium capitalize text-muted-foreground">
            {roleLabels[finding.role] ?? finding.role}
          </span>
        </div>
        <p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">
          {finding.sourceKind}
        </p>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <Link
            to={`/findings/${finding.id}`}
            className="min-w-0 flex-1 text-sm font-medium leading-snug hover:text-primary"
          >
            {finding.title ?? finding.findingKey}
          </Link>
          <Link
            to={`/findings/${finding.id}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
            aria-label={`Open ${finding.findingKey}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {finding.findingKey}
        </p>
        {finding.rationale && (
          <MarkdownBlock
            content={renderMarkdown(finding.rationale)}
            className="mt-2 text-xs text-muted-foreground"
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Shared small components ---------- */

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-all text-sm">{value}</dd>
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h4
      className={cn(
        'mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      {children}
    </h4>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof Search; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="mb-2 h-6 w-6 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ---------- Main Page ---------- */

export function FindingsPage() {
  const navigate = useNavigate();
  const { findingId, storyId } = useParams<{ findingId?: string; storyId?: string }>();
  const [activeTab, setActiveTab] = useState<'stories' | 'findings' | 'noise'>('stories');
  const {
    data: relevantFindingsData,
    isLoading: relevantFindingsLoading,
    error: relevantFindingsError,
  } = useQuery({
    queryKey: ['security-ingestion', 'findings', 'relevant'],
    queryFn: () =>
      api.securityIngestion.findings({ status: 'open', userVisibleOnly: true, limit: 200 }),
    refetchInterval: 20_000,
  });
  const {
    data: noiseFindingsData,
    isLoading: noiseFindingsLoading,
    error: noiseFindingsError,
  } = useQuery({
    queryKey: ['security-ingestion', 'findings', 'noise'],
    queryFn: () =>
      api.securityIngestion.findings({
        status: 'open',
        assessmentVerdict: 'not_relevant',
        limit: 200,
      }),
    refetchInterval: 20_000,
  });
  const {
    data: threatStoriesData,
    isLoading: threatStoriesLoading,
    error: threatStoriesError,
  } = useQuery({
    queryKey: ['security-ingestion', 'threat-stories'],
    queryFn: () => api.securityIngestion.threatStories({ limit: 50 }),
    refetchInterval: 20_000,
  });

  const relevantFindings = relevantFindingsData?.findings ?? [];
  const noiseFindings = noiseFindingsData?.findings ?? [];
  const findings = activeTab === 'noise' ? noiseFindings : relevantFindings;
  const allLoadedFindings = useMemo(
    () => [...relevantFindings, ...noiseFindings],
    [relevantFindings, noiseFindings],
  );
  const findingsLoading = activeTab === 'noise' ? noiseFindingsLoading : relevantFindingsLoading;
  const findingsError = activeTab === 'noise' ? noiseFindingsError : relevantFindingsError;
  const threatStories = threatStoriesData?.stories ?? [];

  // Severity counts for the stats bar
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    relevantFindings.forEach((f) => {
      const key = f.severity.toLowerCase();
      if (key in counts) counts[key]++;
    });
    return counts;
  }, [relevantFindings]);

  const storySeverityCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    threatStories.forEach((s) => {
      const key = s.severity.toLowerCase();
      if (key in counts) counts[key]++;
    });
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([severity, count]) => ({ severity, count }));
  }, [threatStories]);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [storySearchQuery, setStorySearchQuery] = useState('');
  const [storySeverityFilter, setStorySeverityFilter] = useState<string | null>(null);
  const [listVariant, setListVariant] = useState(0);

  // Selection from URL
  const selection: Selection | null = useMemo(() => {
    if (findingId) {
      const item = allLoadedFindings.find((f) => f.id === findingId);
      if (item) return { kind: 'finding', item };
    }
    if (storyId) {
      const item = threatStories.find((s) => s.id === storyId);
      if (item) return { kind: 'story', item };
    }
    return null;
  }, [findingId, storyId, allLoadedFindings, threatStories]);

  // Filtered findings
  const filteredFindings = useMemo(() => {
    let result = findings;
    if (severityFilter) result = result.filter((f) => f.severity.toLowerCase() === severityFilter);
    if (statusFilter) result = result.filter((f) => getResolvedStatus(f) === statusFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.title?.toLowerCase().includes(q) ||
          f.findingKey.toLowerCase().includes(q) ||
          f.file?.toLowerCase().includes(q) ||
          f.repository?.toLowerCase().includes(q) ||
          f.description?.toLowerCase().includes(q),
      );
    }
    return result.sort(
      (a, b) =>
        (severityOrder[a.severity.toLowerCase()] ?? 5) -
        (severityOrder[b.severity.toLowerCase()] ?? 5),
    );
  }, [findings, severityFilter, statusFilter, searchQuery]);

  // Filtered stories
  const filteredStories = useMemo(() => {
    let result = threatStories;
    if (storySeverityFilter)
      result = result.filter((s) => s.severity.toLowerCase() === storySeverityFilter);
    if (storySearchQuery) {
      const q = storySearchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.title?.toLowerCase().includes(q) ||
          s.storyKey.toLowerCase().includes(q) ||
          s.summary?.toLowerCase().includes(q),
      );
    }
    return result.sort(
      (a, b) =>
        (severityOrder[a.severity.toLowerCase()] ?? 5) -
        (severityOrder[b.severity.toLowerCase()] ?? 5),
    );
  }, [threatStories, storySeverityFilter, storySearchQuery]);

  const storyAvailableSeverities = useMemo(
    () =>
      [...new Set(threatStories.map((s) => s.severity.toLowerCase()))].sort(
        (a, b) => (severityOrder[a] ?? 5) - (severityOrder[b] ?? 5),
      ),
    [threatStories],
  );

  const storyHasFilters = storySeverityFilter !== null || storySearchQuery !== '';

  const availableSeverities = useMemo(
    () =>
      [...new Set(findings.map((f) => f.severity.toLowerCase()))].sort(
        (a, b) => (severityOrder[a] ?? 5) - (severityOrder[b] ?? 5),
      ),
    [findings],
  );

  const hasFilters = severityFilter !== null || statusFilter !== null || searchQuery !== '';

  useEffect(() => {
    if (storyId) {
      setActiveTab('stories');
      return;
    }
    if (!findingId) return;
    setActiveTab(noiseFindings.some((finding) => finding.id === findingId) ? 'noise' : 'findings');
  }, [findingId, storyId, noiseFindings]);

  // List content per tab
  const listContent =
    activeTab === 'stories' ? (
      <>
        <div className="shrink-0 space-y-2 border-b px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search stories..."
              value={storySearchQuery}
              onChange={(e) => setStorySearchQuery(e.target.value)}
              className="h-7 w-full rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {storyAvailableSeverities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <Filter className="h-3 w-3 text-muted-foreground" />
              {storyAvailableSeverities.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={storySeverityFilter === s}
                  onClick={() => setStorySeverityFilter(storySeverityFilter === s ? null : s)}
                />
              ))}
              {storyHasFilters && (
                <button
                  type="button"
                  className="ml-1 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setStorySeverityFilter(null);
                    setStorySearchQuery('');
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5 p-2">
            {threatStoriesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : threatStoriesError ? (
              <p className="p-4 text-center text-xs text-red-500">Failed to load</p>
            ) : filteredStories.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <Target className="mb-2 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium">No threat stories</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {storyHasFilters
                    ? 'Adjust filters to see results.'
                    : 'Agents will create stories as they correlate findings.'}
                </p>
              </div>
            ) : (
              filteredStories.map((story) => (
                <StoryListItem
                  key={story.id}
                  story={story}
                  active={selection?.kind === 'story' && selection.item.id === story.id}
                  onClick={() => navigate(`/stories/${story.id}`)}
                  variant={listVariant}
                />
              ))
            )}
          </div>
        </div>
      </>
    ) : (
      <>
        <div className="shrink-0 space-y-2 border-b px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-full rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {availableSeverities.map((s) => (
              <FilterChip
                key={s}
                label={s}
                active={severityFilter === s}
                onClick={() => setSeverityFilter(severityFilter === s ? null : s)}
              />
            ))}
            <Separator orientation="vertical" className="mx-0.5 h-3" />
            <FilterChip
              label="Open"
              active={statusFilter === 'open'}
              onClick={() => setStatusFilter(statusFilter === 'open' ? null : 'open')}
            />
            <FilterChip
              label="Pending"
              active={statusFilter === 'fix_pending'}
              onClick={() => setStatusFilter(statusFilter === 'fix_pending' ? null : 'fix_pending')}
            />
            {hasFilters && (
              <button
                type="button"
                className="ml-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSeverityFilter(null);
                  setStatusFilter(null);
                  setSearchQuery('');
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5 p-2">
            {findingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : findingsError ? (
              <p className="p-4 text-center text-xs text-red-500">Failed to load</p>
            ) : filteredFindings.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <FileCode2 className="mb-2 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium">
                  {hasFilters
                    ? 'No matches'
                    : activeTab === 'noise'
                      ? 'No hidden noise'
                      : 'No findings yet'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasFilters
                    ? 'Adjust filters to see results.'
                    : activeTab === 'noise'
                      ? 'Agent assessment has not hidden any scanner output.'
                      : 'Run a security workflow to generate findings.'}
                </p>
              </div>
            ) : (
              filteredFindings.map((finding) => (
                <FindingListItem
                  key={finding.id}
                  finding={finding}
                  active={selection?.kind === 'finding' && selection.item.id === finding.id}
                  onClick={() => navigate(`/findings/${finding.id}`)}
                  variant={listVariant}
                />
              ))
            )}
          </div>
        </div>
      </>
    );

  // --- Custom header via layout slot ---
  const { sidebarOpen, onSidebarToggle } = useLayoutControls();

  const sentinelHeader = useMemo(
    () => (
      <div className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Primary bar */}
        <div className="flex h-14 items-center gap-2 px-3 md:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSidebarToggle}
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
            className="h-9 w-9 shrink-0"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
          </Button>

          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight leading-tight">
                ShipSec Sentinel
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {threatStories.length} stories
                <span className="mx-1 text-muted-foreground/30">·</span>
                {relevantFindings.length} relevant findings
                <span className="mx-1 text-muted-foreground/30">·</span>
                {noiseFindings.length} hidden as noise
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export report</span>
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Create scan</span>
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 border-t bg-muted/20 px-4 py-2.5">
          <SeverityRing counts={storySeverityCounts} total={threatStories.length} size={48} />
          <Separator orientation="vertical" className="h-7" />
          {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
            <SeverityStatPill key={sev} severity={sev} count={severityCounts[sev] ?? 0} />
          ))}
        </div>
      </div>
    ),
    [
      sidebarOpen,
      onSidebarToggle,
      threatStories.length,
      relevantFindings.length,
      noiseFindings.length,
      storySeverityCounts,
      severityCounts,
    ],
  );

  useCustomHeader(sentinelHeader);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-background">
      {/* ===== Master-detail layout ===== */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel — list */}
        <div className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r 2xl:w-[380px]">
          {/* Tab switcher */}
          <div className="shrink-0 border-b px-3 pt-1">
            <nav className="flex">
              {(
                [
                  {
                    key: 'stories' as const,
                    label: 'Stories',
                    icon: Target,
                    count: threatStories.length,
                  },
                  {
                    key: 'findings' as const,
                    label: 'Findings',
                    icon: ShieldAlert,
                    count: relevantFindings.length,
                  },
                  {
                    key: 'noise' as const,
                    label: 'Noise',
                    icon: FileCode2,
                    count: noiseFindings.length,
                  },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 pb-2.5 pt-2 text-xs font-medium transition-colors',
                    activeTab === t.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                  {t.count > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* List content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listContent}</div>

          {/* Debug variant switcher */}
          <div className="flex shrink-0 items-center justify-between border-t bg-muted/30 px-2 py-1">
            <span className="text-[9px] font-medium text-muted-foreground/50">
              variant {listVariant}
            </span>
            <div className="flex items-center gap-0.5">
              {[0, 1, 2, 3, 4].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setListVariant(v)}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded text-[9px] font-mono transition-colors',
                    listVariant === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground/50 hover:text-foreground',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel — detail */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {!selection ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <Shield className="mb-3 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">
                Select a threat story or finding
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Choose an item from the list to see its full details here.
              </p>
            </div>
          ) : selection.kind === 'story' ? (
            <StoryDetailPanel story={selection.item} />
          ) : (
            <FindingDetailPanel finding={selection.item} knownFindings={findings} />
          )}
        </div>
      </div>
    </div>
  );
}
