import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Github, FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import type { ScanFinding, GitHubRepo } from '@/store/githubStore';
import { SEVERITY_CONFIG } from './scan-utils';
import { cn } from '@/lib/utils';

const WORKSPACE_PREFIXES = ['/workspace/repo/', '/scan/repo/', '/scan/', '/workspace/', '/repo/'];

function stripWorkspacePrefix(filePath: string): string {
  for (const prefix of WORKSPACE_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
  }
  if (filePath.startsWith('/')) {
    return filePath.slice(1);
  }
  return filePath;
}

interface FindingCardProps {
  finding: ScanFinding;
  repository: GitHubRepo | null;
  commitSha: string | null;
  highlighted?: boolean;
  onClick?: () => void;
}

export function FindingCard({
  finding,
  repository,
  commitSha,
  highlighted,
  onClick,
}: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.info;
  const cleanFile = finding.file ? stripWorkspacePrefix(finding.file) : '';
  const hasSnippet = Boolean(finding.snippet);

  const githubFileUrl =
    repository?.htmlUrl && commitSha && cleanFile
      ? `${repository.htmlUrl}/blob/${commitSha}/${cleanFile}${finding.line ? `#L${finding.line}` : ''}`
      : null;

  const handleCardClick = () => {
    onClick?.();
    if (hasSnippet) {
      setExpanded(true);
    }
  };

  return (
    <div
      id={`finding-${finding.id}`}
      className={cn(
        'rounded-lg border p-4 transition-all duration-200',
        config.bgClass,
        highlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        onClick && 'cursor-pointer',
      )}
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge className={`${config.badgeClass} border-none`}>{config.label}</Badge>
            <span className="text-sm font-medium">{finding.type}</span>
            {finding.ruleId && (
              <span className="text-xs text-muted-foreground">({finding.ruleId})</span>
            )}
            {finding.category && (
              <Badge variant="outline" className="text-xs">
                {finding.category}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <FileCode className="h-4 w-4 flex-shrink-0" />
            <span className="font-mono truncate">{cleanFile}</span>
            {finding.line && (
              <span className="flex-shrink-0">
                :{finding.line}
                {finding.endLine && finding.endLine !== finding.line && `-${finding.endLine}`}
              </span>
            )}
          </div>

          <p className="text-sm">{finding.message}</p>

          {hasSnippet && (
            <div className="mt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {expanded ? 'Hide code' : 'Show code'}
              </button>
              {expanded && (
                <pre className="mt-2 p-3 rounded bg-muted/50 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-words">
                  {finding.snippet}
                </pre>
              )}
            </div>
          )}
        </div>

        {githubFileUrl && (
          <a
            href={githubFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Button variant="outline" size="sm" className="gap-1">
              <Github className="h-3 w-3" />
              <span className="hidden sm:inline">View on GitHub</span>
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
