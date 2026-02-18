import { useEffect, useMemo, useState } from 'react';
import { Loader2, Server, CheckCircle2, AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMcpGroups, useMcpGroupServers } from '@/hooks/queries/useMcpGroupQueries';
import type { McpGroupServerResponse } from '@/services/mcpGroupsApi';
import { useQueryClient } from '@tanstack/react-query';

interface McpGroupConfigProps {
  /** Group slug to fetch servers for */
  groupSlug: string;
  /** Currently selected server IDs */
  value: string[];
  /** Callback when selection changes */
  onChange: (servers: string[]) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
}

/**
 * MCP Group Configuration Panel
 *
 * Dynamically fetches servers for a specific MCP group and provides multi-select interface.
 * Displays server name, description, health status, and tool count for each server.
 * Fetches group servers from /api/v1/mcp-groups/{groupId}/servers.
 */
export function McpGroupConfig({
  groupSlug,
  value,
  onChange,
  disabled = false,
}: McpGroupConfigProps) {
  const queryClient = useQueryClient();
  const { data: groups = [] } = useMcpGroups();
  const group = useMemo(() => groups.find((g) => g.slug === groupSlug), [groups, groupSlug]);
  const { data: rawServers = [], isLoading, error: queryError } = useMcpGroupServers(group?.id);
  const servers = useMemo(() => rawServers.filter((s) => s.enabled), [rawServers]);
  const error = queryError?.message ?? null;

  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set(value));
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync external value changes to local state
  useEffect(() => {
    setSelectedServers(new Set(value));
  }, [value]);

  // Notify parent of changes
  useEffect(() => {
    const selectedArray = Array.from(selectedServers).sort();
    const valueSorted = [...value].sort();
    if (JSON.stringify(selectedArray) !== JSON.stringify(valueSorted)) {
      onChange(selectedArray);
    }
  }, [selectedServers, onChange, value]);

  const toggleServer = (serverId: string) => {
    if (disabled) return;

    setSelectedServers((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(serverId)) {
        newSelected.delete(serverId);
      } else {
        newSelected.add(serverId);
      }
      return newSelected;
    });
  };

  const handleRefresh = async () => {
    if (disabled || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['mcpGroups'] });
      if (group?.id) {
        await queryClient.invalidateQueries({ queryKey: ['mcpGroupServers'] });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const getHealthIndicator = (server: McpGroupServerResponse) => {
    const status = server.healthStatus ?? 'unknown';
    switch (status) {
      case 'healthy':
        return (
          <span
            className="w-2.5 h-2.5 rounded-full bg-green-500"
            title="Healthy - All systems operational"
          />
        );
      case 'unhealthy':
        return (
          <span
            className="w-2.5 h-2.5 rounded-full bg-red-500"
            title="Unhealthy - Server not responding"
          />
        );
      default:
        return (
          <span
            className="w-2.5 h-2.5 rounded-full bg-gray-400"
            title="Unknown - Health status not checked"
          />
        );
    }
  };

  const selectedCount = selectedServers.size;
  const totalTools = servers
    .filter((s) => selectedServers.has(s.serverId))
    .reduce((sum, s) => sum + (s.toolCount || 0), 0);

  if (isLoading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading MCP servers...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Error loading servers
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Retry</span>}
        </Button>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <Server className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground mb-1">No MCP servers configured</p>
        <p className="text-xs text-muted-foreground/70">This group has no available servers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with stats and refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {servers.length} server{servers.length !== 1 ? 's' : ''} available
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          title="Refresh servers"
        >
          <Loader2 className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Selection summary */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">
              {selectedCount} server{selectedCount !== 1 ? 's' : ''} selected
            </p>
            {totalTools > 0 && (
              <p className="text-xs text-muted-foreground">
                {totalTools} tool{totalTools !== 1 ? 's' : ''} available to AI agents
              </p>
            )}
          </div>
        </div>
      )}

      {/* Server list */}
      <div className="space-y-2">
        {servers.map((server) => {
          const isSelected = selectedServers.has(server.serverId);
          const serverTools = server.toolCount || 0;

          return (
            <div
              key={server.serverId}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                isSelected
                  ? 'bg-primary/5 border-primary/30'
                  : 'bg-background hover:bg-muted/50 border-border',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Checkbox
                id={`server-${server.serverId}`}
                checked={isSelected}
                disabled={disabled}
                onCheckedChange={() => toggleServer(server.serverId)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <label
                    htmlFor={`server-${server.serverId}`}
                    className={cn(
                      'text-sm font-medium cursor-pointer truncate',
                      disabled && 'cursor-not-allowed',
                    )}
                    onClick={() => !disabled && toggleServer(server.serverId)}
                  >
                    {server.serverName}
                  </label>
                  {getHealthIndicator(server)}
                  {serverTools > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {serverTools} tool{serverTools !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {server.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{server.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Helper text */}
      <div className="text-xs text-muted-foreground px-1">
        Select the AWS MCP servers to enable in this workflow. Each server runs in its own container
        with your credentials.
      </div>
    </div>
  );
}
