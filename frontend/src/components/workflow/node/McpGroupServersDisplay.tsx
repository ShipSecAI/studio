import { useMemo } from 'react';
import { Wrench, CheckCircle2, AlertCircle, HelpCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useMcpGroups, useMcpGroupServers } from '@/hooks/queries/useMcpGroupQueries';

interface McpGroupServersDisplayProps {
  groupSlug: string;
  enabledServers: string[];
  position?: 'top' | 'bottom';
}

/**
 * MCP Group Servers Display - Shows selected MCP servers from a group in the workflow node preview
 *
 * Fetches group servers dynamically and displays as a compact row of server badges with health indicators.
 */
export function McpGroupServersDisplay({
  groupSlug,
  enabledServers,
  position = 'top',
}: McpGroupServersDisplayProps) {
  const { data: groups = [] } = useMcpGroups();
  const group = useMemo(() => groups.find((g) => g.slug === groupSlug), [groups, groupSlug]);
  const { data: rawServers = [], isLoading } = useMcpGroupServers(group?.id);
  const servers = useMemo(() => rawServers.filter((s) => s.enabled), [rawServers]);

  // Filter to only enabled servers that are selected
  const selectedServers = servers.filter((s) => enabledServers.includes(s.serverId));

  // Show loading state if data isn't ready yet
  if (isLoading && servers.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5',
          position === 'top'
            ? 'pb-2 mb-2 border-b border-border/50'
            : 'pt-2 border-t border-border/50',
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (enabledServers.length === 0 || selectedServers.length === 0) {
    return null;
  }

  // Always show chips for selected servers (never use compact mode)
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        position === 'top'
          ? 'pb-2 mb-2 border-b border-border/50'
          : 'pt-2 border-t border-border/50',
      )}
    >
      {selectedServers.map((server) => {
        const status = server.healthStatus ?? 'unknown';
        const StatusIcon =
          status === 'healthy' ? CheckCircle2 : status === 'unhealthy' ? AlertCircle : HelpCircle;
        const statusColor =
          status === 'healthy'
            ? 'text-green-500'
            : status === 'unhealthy'
              ? 'text-red-500'
              : 'text-gray-400';

        return (
          <Badge
            key={server.serverId}
            variant="outline"
            className={cn(
              'text-[10px] px-2 py-0.5 font-medium flex items-center gap-1.5',
              'border-teal-200 dark:border-teal-700/50',
              'bg-teal-50/80 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300',
              'hover:bg-teal-100/80 dark:hover:bg-teal-900/30 transition-colors',
            )}
          >
            <StatusIcon className={cn('h-2.5 w-2.5 flex-shrink-0', statusColor)} />
            <Wrench className="h-2.5 w-2.5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
            <span className="truncate max-w-[100px] font-medium">{server.serverName}</span>
            {server.toolCount > 0 && (
              <span className="text-[9px] px-1 py-0 rounded-full bg-teal-200/50 dark:bg-teal-800/50 text-teal-800 dark:text-teal-200">
                {server.toolCount}
              </span>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
