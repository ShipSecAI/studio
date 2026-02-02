import { useEffect, useRef } from 'react';
import { useMcpServerStore, type McpServerStore } from '@/store/mcpServerStore';

/**
 * Hook to poll MCP server health status at regular intervals.
 * Use this on pages that need real-time health updates.
 */
export function useMcpHealthPolling(intervalMs = 15_000, enabled = true) {
  const refreshHealth = useMcpServerStore((state) => state.refreshHealth);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    refreshHealth();

    // Set up polling
    intervalRef.current = setInterval(() => {
      refreshHealth();
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refreshHealth, intervalMs, enabled]);
}

/**
 * Hook to fetch MCP servers and tools on mount.
 * Useful for components that need the full MCP data.
 */
export function useMcpServersWithTools(): Pick<
  McpServerStore,
  'servers' | 'tools' | 'healthStatus' | 'isLoading' | 'error'
> {
  const { servers, tools, healthStatus, isLoading, error, fetchServers, fetchAllTools } =
    useMcpServerStore();

  useEffect(() => {
    fetchServers();
    fetchAllTools();
  }, [fetchServers, fetchAllTools]);

  return {
    servers,
    tools,
    healthStatus,
    isLoading,
    error,
  };
}
