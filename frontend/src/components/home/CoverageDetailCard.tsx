import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { GitHubRepo, TriggerRule } from '@/store/githubStore';

interface CoverageDetailCardProps {
  repositories: GitHubRepo[];
  triggerRules: TriggerRule[];
}

export function CoverageDetailCard({ repositories, triggerRules }: CoverageDetailCardProps) {
  const { reposWithStatus, protectedCount } = useMemo(() => {
    const repoPatterns = new Set(triggerRules.map((r) => r.repositoryPattern));
    const hasWildcard = repoPatterns.has('*');

    const nextRepos = repositories.map((repo) => ({
      ...repo,
      protected: hasWildcard || repoPatterns.has(repo.fullName),
    }));

    return {
      reposWithStatus: nextRepos,
      protectedCount: nextRepos.filter((r) => r.protected).length,
    };
  }, [repositories, triggerRules]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Coverage</CardTitle>
          <span className="text-xs text-muted-foreground">
            {protectedCount}/{repositories.length} protected
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repositories connected.</p>
        ) : (
          <div className="space-y-1.5">
            {reposWithStatus.map((repo) => (
              <div key={repo.id} className="flex items-center gap-2 text-xs p-1">
                {repo.protected ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                ) : (
                  <ShieldOff className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                )}
                <span className="truncate flex-1 min-w-0">
                  {repo.fullName?.split('/').pop() ?? repo.fullName}
                </span>
                {!repo.protected && (
                  <Link
                    to="/github/triggers"
                    className="text-[10px] text-primary hover:underline flex-shrink-0"
                  >
                    Protect
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
