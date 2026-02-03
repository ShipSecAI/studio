import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Server, Wrench, RefreshCw, AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMcpServerStore } from '@/store/mcpServerStore';

interface McpLibraryToolSelectorProps {
  /** Whether Custom MCPs is enabled (controls visibility) */
  enabled?: boolean;
  /** List of excluded server IDs */
  serverExclusions?: string[];
  /** List of excluded tool names */
  toolExclusions?: string[];
  /** Callback when server exclusions change */
  onServerExclusionChange?: (exclusions: string[] | undefined) => void;
  /** Callback when tool exclusions change */
  onToolExclusionChange?: (exclusions: string[] | undefined) => void;
}

type ExpandedState = Record<string, boolean>;

/**
 * Custom MCPs Tool Selector
 *
 * Shows MCP servers from the library with health status indicators.
 * Allows users to exclude specific servers or tools from being available to the AI agent.
 */
export function McpLibraryToolSelector({
  enabled = true,
  serverExclusions = [],
  toolExclusions = [],
  onServerExclusionChange,
  onToolExclusionChange,
}: McpLibraryToolSelectorProps) {
  const {
    servers,
    tools,
    healthStatus,
    isLoading,
    error,
    fetchServers,
    fetchAllTools,
    refreshHealth,
  } = useMcpServerStore();

  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch servers and tools on mount
  useEffect(() => {
    if (enabled) {
      fetchServers();
      fetchAllTools();
    }
  }, [enabled, fetchServers, fetchAllTools]);

  // Only show enabled servers
  const enabledServers = servers.filter((s) => s.enabled);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchServers({ force: true }), fetchAllTools(), refreshHealth()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleServer = (serverId: string) => {
    setExpanded((prev) => ({
      ...prev,
      [serverId]: !prev[serverId],
    }));
  };

  const isServerExcluded = (serverId: string) => serverExclusions.includes(serverId);
  const isToolExcluded = (toolName: string) => toolExclusions.includes(toolName);

  const handleServerExclusionToggle = (serverId: string) => {
    const newExclusions = isServerExcluded(serverId)
      ? serverExclusions.filter((id) => id !== serverId)
      : [...serverExclusions, serverId];

    onServerExclusionChange?.(newExclusions.length > 0 ? newExclusions : undefined);
  };

  const handleToolExclusionToggle = (toolName: string) => {
    const newExclusions = isToolExcluded(toolName)
      ? toolExclusions.filter((name) => name !== toolName)
      : [...toolExclusions, toolName];

    onToolExclusionChange?.(newExclusions.length > 0 ? newExclusions : undefined);
  };

  const getHealthIndicator = (serverId: string) => {
    const status = healthStatus[serverId] ?? 'unknown';
    switch (status) {
      case 'healthy':
        return <span className="w-2 h-2 rounded-full bg-green-500" title="Healthy" />;
      case 'unhealthy':
        return <span className="w-2 h-2 rounded-full bg-red-500" title="Unhealthy" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-gray-400" title="Unknown" />;
    }
  };

  const getServerTools = (serverId: string) => tools.filter((t) => t.serverId === serverId);

  if (!enabled) {
    return null;
  }

  if (isLoading && servers.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">Loading MCP servers...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive py-2">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{error}</span>
      </div>
    );
  }

  if (enabledServers.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        No MCP servers configured. Add servers in the{' '}
        <a href="/mcp-library" className="text-primary hover:underline">
          Custom MCPs
        </a>
        .
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {enabledServers.length} server{enabledServers.length !== 1 ? 's' : ''} available
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh servers"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Server list */}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {enabledServers.map((server) => {
          const serverTools = getServerTools(server.id);
          const isExpanded = expanded[server.id] ?? false;
          const excluded = isServerExcluded(server.id);
          const status = healthStatus[server.id] ?? 'unknown';
          const isUnhealthy = status === 'unhealthy';

          return (
            <div
              key={server.id}
              className={cn(
                'rounded-md border',
                excluded && 'opacity-50',
                isUnhealthy && 'border-red-200 dark:border-red-900',
              )}
            >
              {/* Server header */}
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleServer(server.id)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>

                <Checkbox
                  id={`server-${server.id}`}
                  checked={!excluded}
                  onCheckedChange={() => handleServerExclusionToggle(server.id)}
                  className="h-3.5 w-3.5"
                />

                {getHealthIndicator(server.id)}

                <Server className="h-3.5 w-3.5 text-muted-foreground" />

                <label
                  htmlFor={`server-${server.id}`}
                  className={cn(
                    'flex-1 text-xs font-medium cursor-pointer truncate',
                    excluded && 'line-through text-muted-foreground',
                  )}
                  title={server.name}
                >
                  {server.name}
                </label>

                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  {server.transportType}
                </Badge>

                {serverTools.length > 0 && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    {serverTools.length} tool{serverTools.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>

              {/* Expanded tools list */}
              {isExpanded && serverTools.length > 0 && (
                <div className="border-t px-2 py-1.5 space-y-1 bg-muted/30">
                  {serverTools.map((tool) => {
                    const toolExcluded = isToolExcluded(tool.toolName);
                    return (
                      <div key={tool.id} className="flex items-center gap-2 pl-6">
                        <Checkbox
                          id={`tool-${tool.id}`}
                          checked={!toolExcluded && !excluded}
                          onCheckedChange={() => handleToolExclusionToggle(tool.toolName)}
                          disabled={excluded}
                          className="h-3 w-3"
                        />
                        <Wrench className="h-3 w-3 text-muted-foreground" />
                        <label
                          htmlFor={`tool-${tool.id}`}
                          className={cn(
                            'flex-1 text-[11px] cursor-pointer truncate',
                            (toolExcluded || excluded) && 'line-through text-muted-foreground',
                          )}
                          title={tool.description ?? tool.toolName}
                        >
                          {tool.toolName}
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Show message if no tools discovered */}
              {isExpanded && serverTools.length === 0 && (
                <div className="border-t px-2 py-1.5 bg-muted/30">
                  <span className="text-[10px] text-muted-foreground pl-6">
                    No tools discovered. Check server health.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary of exclusions */}
      {(serverExclusions.length > 0 || toolExclusions.length > 0) && (
        <div className="text-[10px] text-muted-foreground pt-1 border-t">
          {serverExclusions.length > 0 && (
            <div>
              {serverExclusions.length} server{serverExclusions.length !== 1 ? 's' : ''} excluded
            </div>
          )}
          {toolExclusions.length > 0 && (
            <div>
              {toolExclusions.length} tool{toolExclusions.length !== 1 ? 's' : ''} excluded
            </div>
          )}
        </div>
      )}
    </div>
  );
}
