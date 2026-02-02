import { CheckCircle2, AlertCircle, HelpCircle, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useMcpGroupStore } from '@/store/mcpGroupStore';
import { useMcpServerStore } from '@/store/mcpServerStore';

interface McpGroupServersDisplayProps {
  groupId: string;
  enabledServers: string[];
  position?: 'top' | 'bottom';
  compact?: boolean;
}

/**
 * MCP Group Servers Display - Shows selected MCP servers from a group in the workflow node preview
 *
 * Displays as a compact row of server badges with health indicators.
 * Fetches server details from the MCP group store to show names.
 */
export function McpGroupServersDisplay({
  groupId,
  enabledServers,
  position = 'bottom',
  compact = true,
}: McpGroupServersDisplayProps) {
  const { getGroupServers } = useMcpGroupStore();
  const { healthStatus } = useMcpServerStore();

  const groupServers = getGroupServers(groupId);
  const selectedServers = groupServers.filter(
    (s) => s.enabled && enabledServers.includes(s.serverId),
  );

  if (enabledServers.length === 0 || selectedServers.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        position === 'top'
          ? 'pb-2 mb-2 border-b border-border/50'
          : 'pt-2 border-t border-border/50',
      )}
    >
      {compact ? (
        // Compact mode: Show count + one badge preview
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {selectedServers.length} server{selectedServers.length !== 1 ? 's' : ''}
            </span>
          </div>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
          >
            {selectedServers[0]?.serverName || 'Server'}
            {selectedServers.length > 1 && ` +${selectedServers.length - 1}`}
          </Badge>
        </div>
      ) : (
        // Full mode: Show all servers with health indicators
        <div className="flex flex-wrap gap-1.5">
          {selectedServers.slice(0, 3).map((server) => {
            const status = healthStatus[server.serverId] ?? 'unknown';
            const StatusIcon =
              status === 'healthy'
                ? CheckCircle2
                : status === 'unhealthy'
                  ? AlertCircle
                  : HelpCircle;
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
                  'text-[10px] px-1.5 py-0 font-medium flex items-center gap-1 border-indigo-200 dark:border-indigo-700',
                  'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
                )}
              >
                <StatusIcon className={cn('h-2.5 w-2.5', statusColor)} />
                <span className="truncate max-w-[80px]">{server.serverName}</span>
              </Badge>
            );
          })}
          {selectedServers.length > 3 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
              +{selectedServers.length - 3} more
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
