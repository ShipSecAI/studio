import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useTerminalStream,
  type UseTerminalStreamOptions,
  type UseTerminalStreamResult,
} from './useTerminalStream';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { api } from '@/services/api';

export interface UseTimelineTerminalStreamOptions extends UseTerminalStreamOptions {
  /**
   * Enable timeline synchronization mode.
   * When enabled, terminal will update based on timeline position.
   */
  timelineSync?: boolean;
}

export interface UseTimelineTerminalStreamResult extends UseTerminalStreamResult {
  /**
   * Chunks up to current timeline position (only in timeline sync mode)
   */
  timelineChunks: ReturnType<typeof useTerminalStream>['chunks'];
  /**
   * Whether terminal is in timeline sync mode
   */
  isTimelineSync: boolean;
  /**
   * Whether chunks are being fetched for timeline position
   */
  isFetchingTimeline: boolean;
  /**
   * Whether there is any data available (regardless of timeline filtering)
   */
  hasData: boolean;
}

/**
 * Hook for timeline-synchronized terminal streaming.
 *
 * SIMPLE LOGIC:
 * 1. When timeline sync is enabled, fetch ALL chunks once when timeline loads
 * 2. Filter chunks by current timeline position (chunk.recordedAt <= timelineStartTime + currentTime)
 * 3. Return filtered chunks - rendering component handles forward/backward logic
 */
export function useTimelineTerminalStream(
  options: UseTimelineTerminalStreamOptions,
): UseTimelineTerminalStreamResult {
  const { timelineSync = false, ...terminalOptions } = options;

  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode);
  const currentTime = useExecutionTimelineStore((state) => state.currentTime);
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime);
  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId);
  const isLiveFollowing = useExecutionTimelineStore((state) => state.isLiveFollowing);
  const isLiveView = playbackMode === 'live' && isLiveFollowing;

  // Disable autoConnect in timeline sync mode (replay) - we fetch all chunks via API
  const shouldAutoConnect =
    timelineSync && !isLiveView ? false : terminalOptions.autoConnect !== false;
  const shouldHydrateOnMount = !(timelineSync && !isLiveView);

  const terminalResult = useTerminalStream({
    ...terminalOptions,
    autoConnect: shouldAutoConnect,
    hydrateOnMount: shouldHydrateOnMount,
  });

  // Store ALL chunks fetched from API (only in timeline sync mode)
  const [allChunks, setAllChunks] = useState<typeof terminalResult.chunks>([]);
  const [isFetchingTimeline, setIsFetchingTimeline] = useState(false);
  const fetchedRunIdRef = useRef<string | null | undefined>(null);

  // Reset state when runId changes
  useEffect(() => {
    setAllChunks([]);
    fetchedRunIdRef.current = null;
  }, [terminalOptions.runId]);

  // Fetch ALL chunks once when timeline sync is enabled and we have a runId
  useEffect(() => {
    if (
      !timelineSync ||
      isLiveView ||
      !selectedRunId ||
      !terminalOptions.runId ||
      !terminalOptions.nodeId
    ) {
      return;
    }

    // Only fetch once per run
    if (fetchedRunIdRef.current === terminalOptions.runId) {
      return;
    }

    // Fetch all chunks from workflow start (no endTime = get everything)
    const fetchAllChunks = async () => {
      setIsFetchingTimeline(true);
      try {
        const result = await api.executions.getTerminalChunks(terminalOptions.runId!, {
          nodeRef: terminalOptions.nodeId,
          stream: terminalOptions.stream,
          // No startTime/endTime = fetch everything
        });

        // Sort by chunkIndex to ensure correct order
        const sorted = [...result.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
        setAllChunks(sorted);
        fetchedRunIdRef.current = terminalOptions.runId;
      } catch (error) {
        console.error('[useTimelineTerminalStream] Failed to fetch chunks', error);
      } finally {
        setIsFetchingTimeline(false);
      }
    };

    void fetchAllChunks();
  }, [
    timelineSync,
    playbackMode,
    selectedRunId,
    terminalOptions.runId,
    terminalOptions.nodeId,
    terminalOptions.stream,
    isLiveView,
  ]);

  // Filter chunks by current timeline position
  const displayChunks = useMemo(() => {
    // When NOT in timeline sync mode, use regular stream chunks
    if (!timelineSync || isLiveView) {
      return terminalResult.chunks;
    }

    // In timeline sync mode, filter allChunks by current time
    if (allChunks.length === 0) {
      return [];
    }

    if (!timelineStartTime) {
      // No timeline start time yet, return empty
      return [];
    }

    // Calculate effective timeline start time
    // If chunks have timestamps before workflow start, use first chunk's timestamp as the effective start
    const firstChunkTime =
      allChunks.length > 0 ? new Date(allChunks[0].recordedAt).getTime() : null;
    const lastChunkTime =
      allChunks.length > 0 ? new Date(allChunks[allChunks.length - 1].recordedAt).getTime() : null;
    const effectiveStartTime =
      firstChunkTime && firstChunkTime < timelineStartTime ? firstChunkTime : timelineStartTime;

    // Check if all chunks have the same timestamp (or very close timestamps)
    const timeRange = lastChunkTime && firstChunkTime ? lastChunkTime - firstChunkTime : 0;
    const allSameTimestamp = timeRange < 1000; // Less than 1 second difference

    let filtered: typeof allChunks;
    const targetAbsoluteTime = effectiveStartTime + currentTime;
    if (allSameTimestamp && allChunks.length > 0) {
      // All chunks have same timestamp - filter by chunkIndex proportionally
      // Calculate how many chunks should be shown based on currentTime vs totalDuration
      // Use chunkIndex to determine position
      const totalDuration = useExecutionTimelineStore.getState().totalDuration;
      if (totalDuration > 0 && currentTime >= 0) {
        const progress = Math.min(currentTime / totalDuration, 1.0);
        const targetChunkIndex = Math.ceil(allChunks.length * progress);
        filtered = allChunks.filter((chunk) => chunk.chunkIndex <= targetChunkIndex);
      } else {
        // No duration info, show all chunks
        filtered = allChunks;
      }
    } else {
      // Normal time-based filtering
      filtered = allChunks.filter((chunk) => {
        const chunkTime = new Date(chunk.recordedAt).getTime();
        return chunkTime <= targetAbsoluteTime;
      });
    }

    return filtered;
  }, [
    timelineSync,
    playbackMode,
    allChunks,
    timelineStartTime,
    currentTime,
    terminalResult.chunks,
    isLiveView,
  ]);

  // When timeline sync is active, disable regular stream mode to prevent double rendering
  const finalMode = timelineSync && playbackMode !== 'live' ? 'replay' : terminalResult.mode;

  // hasData indicates whether any terminal data is available (regardless of timeline filtering)
  // In timeline sync mode, check allChunks; otherwise check terminalResult.chunks
  const hasData =
    timelineSync && !isLiveView ? allChunks.length > 0 : terminalResult.chunks.length > 0;

  return {
    ...terminalResult,
    chunks: displayChunks,
    timelineChunks: displayChunks,
    mode: finalMode,
    isTimelineSync: timelineSync && playbackMode !== 'live',
    isFetchingTimeline,
    hasData,
  };
}
