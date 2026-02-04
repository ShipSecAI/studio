import { Wrench, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useMcpServerStore } from '@/store/mcpServerStore';

interface McpServersDisplayProps {
  enabledServers: string[];
  position?: 'top' | 'bottom';
  compact?: boolean;
}

/**
 * MCP Servers Display - Shows selected MCP servers in the workflow node preview
 *
 * Displays as a compact row of server badges with health indicators.
 * Fetches server details from the MCP server store to show names.
 */
export function McpServersDisplay({
  enabledServers,
  position = 'bottom',
  compact = true,
}: McpServersDisplayProps) {
  const { servers } = useMcpServerStore();

  if (enabledServers.length === 0) {
    return null;
  }

  // Filter to only enabled servers that are selected
  const selectedServers = servers.filter((s) => s.enabled && enabledServers.includes(s.id));

  // If no matching servers found, don't show anything (might still be loading)
  if (selectedServers.length === 0) {
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
            <Wrench className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {selectedServers.length} server{selectedServers.length !== 1 ? 's' : ''}
            </span>
          </div>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 font-medium bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
          >
            {selectedServers[0]?.name || 'Server'}
            {selectedServers.length > 1 && ` +${selectedServers.length - 1}`}
          </Badge>
        </div>
      ) : (
        // Full mode: Show all servers with health indicators
        <div className="flex flex-wrap gap-1.5">
          {selectedServers.slice(0, 3).map((server) => {
            const status = server.lastHealthStatus ?? 'unknown';
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
                key={server.id}
                variant="outline"
                className={cn(
                  'text-[10px] px-1.5 py-0 font-medium flex items-center gap-1 border-teal-200 dark:border-teal-700',
                  'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
                )}
              >
                <StatusIcon className={cn('h-2.5 w-2.5', statusColor)} />
                <span className="truncate max-w-[80px]">{server.name}</span>
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
