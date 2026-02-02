import { useEffect, useState } from 'react';
import { Loader2, Wrench, CheckCircle2, AlertCircle, HelpCircle, Layers } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMcpGroupStore } from '@/store/mcpGroupStore';
import { useMcpServerStore } from '@/store/mcpServerStore';
import type { McpGroupServerResponse } from '@/services/mcpGroupsApi';

interface McpGroupConfigProps {
  /** The group ID to configure */
  groupId: string;
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
 * Provides a multi-select interface for choosing MCP servers from a predefined group.
 * Displays server name, description, health status, and tool count for each server.
 * Fetches available servers from the group's server list.
 */
export function McpGroupConfig({
  groupId,
  value,
  onChange,
  disabled = false,
}: McpGroupConfigProps) {
  const { fetchGroupServers, getHealthStatus, isLoading, error } = useMcpGroupStore();

  const { tools } = useMcpServerStore();

  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set(value));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [groupServers, setGroupServers] = useState<McpGroupServerResponse[]>([]);

  // Fetch group servers on mount
  useEffect(() => {
    const loadServers = async () => {
      try {
        const servers = await fetchGroupServers(groupId);
        setGroupServers(servers);
      } catch (err) {
        console.error('Failed to load group servers:', err);
      }
    };
    void loadServers();
  }, [groupId, fetchGroupServers]);

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
      const servers = await fetchGroupServers(groupId, { force: true });
      setGroupServers(servers);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getHealthIndicator = (serverId: string) => {
    const status = getHealthStatus(serverId);
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

  const getServerTools = (serverId: string) => {
    return tools.filter((t) => t.serverId === serverId && t.enabled);
  };

  const enabledGroupServers = groupServers.filter((s) => s.enabled);

  if (isLoading && groupServers.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading group servers...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            Error loading group servers
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Retry</span>}
        </Button>
      </div>
    );
  }

  if (enabledGroupServers.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <Layers className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground mb-1">No servers available in this group</p>
        <p className="text-xs text-muted-foreground/70">
          Add servers to the group or enable existing servers.
        </p>
      </div>
    );
  }

  const selectedCount = selectedServers.size;
  const totalTools = Array.from(selectedServers).reduce(
    (sum, serverId) => sum + getServerTools(serverId).length,
    0,
  );

  return (
    <div className="space-y-3">
      {/* Header with stats and refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {enabledGroupServers.length} server{enabledGroupServers.length !== 1 ? 's' : ''} in
            group
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          title="Refresh servers and health status"
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
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {enabledGroupServers.map((server) => {
          const serverTools = getServerTools(server.serverId);
          const isSelected = selectedServers.has(server.serverId);
          const status = getHealthStatus(server.serverId);
          const isUnhealthy = status === 'unhealthy';

          return (
            <div
              key={server.serverId}
              className={cn(
                'rounded-lg border transition-all',
                'hover:shadow-sm',
                isSelected
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'border-border bg-background hover:border-primary/30',
                isUnhealthy && 'border-red-200 dark:border-red-900/50',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div
                className={cn('flex items-start gap-3 p-3', !disabled && 'cursor-pointer')}
                onClick={() => toggleServer(server.serverId)}
              >
                {/* Checkbox */}
                <Checkbox
                  id={`server-${server.serverId}`}
                  checked={isSelected}
                  disabled={disabled}
                  className="mt-0.5"
                  onCheckedChange={() => toggleServer(server.serverId)}
                  onClick={(e) => e.stopPropagation()}
                />

                {/* Server info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {/* Health indicator */}
                    {getHealthIndicator(server.serverId)}

                    {/* Server name */}
                    <label
                      htmlFor={`server-${server.serverId}`}
                      className={cn(
                        'text-sm font-medium cursor-pointer truncate',
                        isSelected && 'text-primary',
                      )}
                      title={server.serverName}
                    >
                      {server.serverName}
                    </label>

                    {/* Transport type badge */}
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 font-normal flex-shrink-0"
                    >
                      {server.transportType}
                    </Badge>
                  </div>

                  {/* Description */}
                  {server.description && (
                    <p
                      className="text-xs text-muted-foreground line-clamp-2 mb-2"
                      title={server.description}
                    >
                      {server.description}
                    </p>
                  )}

                  {/* Metadata */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {/* Tool count */}
                    <div className="flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      <span>
                        {serverTools.length} tool{serverTools.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Health status text */}
                    <div className="flex items-center gap-1">
                      {status === 'healthy' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      {status === 'unhealthy' && <AlertCircle className="h-3 w-3 text-red-500" />}
                      {status === 'unknown' && <HelpCircle className="h-3 w-3 text-gray-400" />}
                      <span className="capitalize">{status}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning for unhealthy servers */}
              {isUnhealthy && (
                <div className="px-3 pb-2">
                  <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded px-2 py-1.5">
                    <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span>Server is not responding. Tools may not be available.</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center pt-2 border-t">
        Selected servers will register their tools with the AI Agent
      </div>
    </div>
  );
}
