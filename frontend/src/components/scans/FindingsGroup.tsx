import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ScanFinding, GitHubRepo } from '@/store/githubStore';
import { SEVERITY_CONFIG } from './scan-utils';
import { FindingCard } from './FindingCard';

interface FindingsGroupProps {
  severity: string;
  findings: ScanFinding[];
  repository: GitHubRepo | null;
  commitSha: string | null;
  highlightedFindingId?: string;
  defaultExpanded?: boolean;
  onFindingClick?: (findingId: string) => void;
}

export function FindingsGroup({
  severity,
  findings,
  repository,
  commitSha,
  highlightedFindingId,
  defaultExpanded,
  onFindingClick,
}: FindingsGroupProps) {
  const [collapsed, setCollapsed] = useState(
    defaultExpanded === undefined ? false : !defaultExpanded,
  );
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;

  if (findings.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors w-full text-left"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className={config.textClass}>{config.label}</span>
        <span className="text-muted-foreground">({findings.length})</span>
      </button>
      {!collapsed && (
        <div className="space-y-3 pl-6">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              repository={repository}
              commitSha={commitSha}
              highlighted={highlightedFindingId === finding.id}
              onClick={onFindingClick ? () => onFindingClick(finding.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
