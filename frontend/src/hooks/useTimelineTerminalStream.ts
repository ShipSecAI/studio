import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTerminalStream, type UseTerminalStreamOptions, type UseTerminalStreamResult } from './useTerminalStream'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { api } from '@/services/api'

export interface UseTimelineTerminalStreamOptions extends UseTerminalStreamOptions {
  /**
   * Enable timeline synchronization mode.
   * When enabled, terminal will update based on timeline position.
   */
  timelineSync?: boolean
}

export interface UseTimelineTerminalStreamResult extends UseTerminalStreamResult {
  /**
   * Chunks up to current timeline position (only in timeline sync mode)
   */
  timelineChunks: ReturnType<typeof useTerminalStream>['chunks']
  /**
   * Whether terminal is in timeline sync mode
   */
  isTimelineSync: boolean
  /**
   * Whether chunks are being fetched for timeline position
   */
  isFetchingTimeline: boolean
}

/**
 * Hook for timeline-synchronized terminal streaming.
 * When timelineSync is enabled, terminal content updates based on timeline position.
 * 
 * Implementation follows asciinema approach:
 * - When seeking backward: reset terminal and rebuild from start
 * - When seeking forward: fast-forward from current position
 * - Always fetch chunks from workflow start to current timeline position
 */
export function useTimelineTerminalStream(
  options: UseTimelineTerminalStreamOptions,
): UseTimelineTerminalStreamResult {
  const { timelineSync = false, ...terminalOptions } = options
  
  // Use separate selectors to avoid creating new objects on every render
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode)
  
  // Only disable autoConnect if timelineSync is enabled AND we're not in live mode
  // In live mode, we always want autoConnect to work for real-time streaming
  const shouldAutoConnect = timelineSync && playbackMode !== 'live' 
    ? false  // Disable autoConnect in timeline sync mode (replay)
    : terminalOptions.autoConnect !== false  // Use original autoConnect value (defaults to true)
  
  const terminalResult = useTerminalStream({
    ...terminalOptions,
    autoConnect: shouldAutoConnect,
  })
  
  // Use separate selectors to avoid creating new objects on every render
  const currentTime = useExecutionTimelineStore((state) => state.currentTime)
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime)

  const [timelineChunks, setTimelineChunks] = useState<typeof terminalResult.chunks>([])
  const [isFetchingTimeline, setIsFetchingTimeline] = useState(false)
  const lastFetchTimeRef = useRef<number | null>(null)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const cachedChunksRef = useRef<Map<number, typeof terminalResult.chunks>>(new Map())
  const lastTimelineChunksRef = useRef<typeof terminalResult.chunks>([])

  // Helper to set timeline chunks only if they actually changed
  const setTimelineChunksIfChanged = useCallback((newChunks: typeof terminalResult.chunks) => {
    // Compare by length and last chunk index to avoid unnecessary updates
    const lastChunks = lastTimelineChunksRef.current
    if (
      lastChunks.length !== newChunks.length ||
      lastChunks[lastChunks.length - 1]?.chunkIndex !== newChunks[newChunks.length - 1]?.chunkIndex
    ) {
      lastTimelineChunksRef.current = newChunks
      setTimelineChunks(newChunks)
    }
  }, [])

  // Calculate absolute time from timeline position
  const getAbsoluteTimeFromTimeline = useCallback((timelineMs: number): Date | null => {
    if (!timelineStartTime) return null
    return new Date(timelineStartTime + timelineMs)
  }, [timelineStartTime])

  // Fetch terminal chunks from workflow start to target time
  const fetchChunksUpToTime = useCallback(async (targetTimeMs: number) => {
    if (!terminalOptions.runId || !terminalOptions.nodeId || !timelineStartTime) {
      return
    }

    setIsFetchingTimeline(true)
    try {
      const targetAbsoluteTime = getAbsoluteTimeFromTimeline(targetTimeMs)
      if (!targetAbsoluteTime) {
        return
      }

      // Fetch chunks from workflow start to target time
      const startAbsoluteTime = new Date(timelineStartTime)
      const result = await api.executions.getTerminalChunks(terminalOptions.runId, {
        nodeRef: terminalOptions.nodeId,
        stream: terminalOptions.stream,
        startTime: startAbsoluteTime,
        endTime: targetAbsoluteTime,
      })

      // Cache chunks by time range (for 1-second buckets)
      const timeBucket = Math.floor(targetTimeMs / 1000)
      cachedChunksRef.current.set(timeBucket, result.chunks)

      // Merge with cached chunks from earlier buckets
      const allChunks: typeof result.chunks = []
      for (let bucket = 0; bucket <= timeBucket; bucket++) {
        const cached = cachedChunksRef.current.get(bucket)
        if (cached) {
          // Merge and deduplicate by chunkIndex
          const chunkMap = new Map<number, typeof result.chunks[0]>()
          for (const chunk of allChunks) {
            chunkMap.set(chunk.chunkIndex, chunk)
          }
          for (const chunk of cached) {
            chunkMap.set(chunk.chunkIndex, chunk)
          }
          allChunks.length = 0
          allChunks.push(...Array.from(chunkMap.values()).sort((a, b) => a.chunkIndex - b.chunkIndex))
        }
      }

      // If we have new chunks, add them
      if (result.chunks.length > 0) {
        const chunkMap = new Map<number, typeof result.chunks[0]>()
        for (const chunk of allChunks) {
          chunkMap.set(chunk.chunkIndex, chunk)
        }
        for (const chunk of result.chunks) {
          chunkMap.set(chunk.chunkIndex, chunk)
        }
        const merged = Array.from(chunkMap.values()).sort((a, b) => a.chunkIndex - b.chunkIndex)
        setTimelineChunksIfChanged(merged)
      } else if (allChunks.length > 0) {
        setTimelineChunksIfChanged(allChunks)
      } else {
        setTimelineChunksIfChanged(result.chunks)
      }
    } catch (error) {
      console.error('[useTimelineTerminalStream] Failed to fetch chunks for timeline', error)
      // Fallback: don't set chunks on error, let it use existing terminalResult.chunks
    } finally {
      setIsFetchingTimeline(false)
    }
  }, [terminalOptions.runId, terminalOptions.nodeId, terminalOptions.stream, timelineStartTime, getAbsoluteTimeFromTimeline])

  // Store terminalResult.chunks in a ref to avoid dependency issues
  const terminalChunksRef = useRef(terminalResult.chunks)
  useEffect(() => {
    terminalChunksRef.current = terminalResult.chunks
  }, [terminalResult.chunks])

  // Update terminal when timeline position changes (in timeline sync mode)
  useEffect(() => {
    if (!timelineSync || playbackMode === 'live') {
      // Not in sync mode - use regular chunks
      setTimelineChunksIfChanged([])
      return
    }

    if (!timelineStartTime) {
      return // Can't sync without timeline start time
    }

    // Debounce rapid timeline changes (e.g., during scrubbing)
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      // Only fetch if timeline position changed significantly (avoid excessive API calls)
      const timeDiff = lastFetchTimeRef.current
        ? Math.abs(currentTime - lastFetchTimeRef.current)
        : Infinity

      const targetAbsoluteTime = getAbsoluteTimeFromTimeline(currentTime)
      const startAbsoluteTime = timelineStartTime ? new Date(timelineStartTime) : null

      console.log('[useTimelineTerminalStream] Timeline seek detected', {
        currentTimeMs: currentTime,
        timelineStartTime: timelineStartTime,
        targetAbsoluteTime: targetAbsoluteTime?.toISOString(),
        startAbsoluteTime: startAbsoluteTime?.toISOString(),
        timeDiff,
        willFetch: timeDiff > 100 || lastFetchTimeRef.current === null,
        availableChunksCount: terminalChunksRef.current.length,
      })

      // Fetch if timeline moved more than 100ms or this is the first fetch
      if (timeDiff > 100 || lastFetchTimeRef.current === null) {
        console.log('[useTimelineTerminalStream] Fetching chunks from API', {
          currentTimeMs: currentTime,
          targetAbsoluteTime: targetAbsoluteTime?.toISOString(),
        })
        void fetchChunksUpToTime(currentTime)
        lastFetchTimeRef.current = currentTime
      } else {
        // Use cached/filtered chunks for small movements
        if (targetAbsoluteTime && startAbsoluteTime) {
          // Get current chunks from ref (avoid dependency issues)
          const currentChunks = terminalChunksRef.current
          
          console.log('[useTimelineTerminalStream] Filtering existing chunks', {
            currentTimeMs: currentTime,
            totalChunks: currentChunks.length,
            startAbsoluteTime: startAbsoluteTime.toISOString(),
            targetAbsoluteTime: targetAbsoluteTime.toISOString(),
            chunkTimestamps: currentChunks.slice(0, 5).map(c => ({
              chunkIndex: c.chunkIndex,
              recordedAt: c.recordedAt,
              timestamp: new Date(c.recordedAt).toISOString(),
            })),
          })

          const filtered = currentChunks.filter((chunk) => {
            const recordedAt = new Date(chunk.recordedAt)
            const inRange = recordedAt >= startAbsoluteTime && recordedAt <= targetAbsoluteTime
            return inRange
          })

          console.log('[useTimelineTerminalStream] Filtered chunks result', {
            beforeFilter: currentChunks.length,
            afterFilter: filtered.length,
            filteredChunkIndices: filtered.map(c => c.chunkIndex),
            filteredTimestamps: filtered.map(c => ({
              chunkIndex: c.chunkIndex,
              recordedAt: c.recordedAt,
              timestamp: new Date(c.recordedAt).toISOString(),
            })),
          })

          setTimelineChunksIfChanged(filtered)
        }
      }
    }, 150) // 150ms debounce (same as asciinema)

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [timelineSync, currentTime, timelineStartTime, playbackMode, fetchChunksUpToTime, getAbsoluteTimeFromTimeline, setTimelineChunksIfChanged])

  // Determine which chunks to use
  // In live mode or when not syncing, use terminalResult.chunks directly (always fresh)
  // In timeline sync mode (replay), use filtered timelineChunks
  const displayChunks = useMemo(() => {
    if (!timelineSync || playbackMode === 'live') {
      // In live mode, always use terminalResult.chunks directly for real-time updates
      return terminalResult.chunks
    }
    
    // In timeline sync mode (replay), always filter by time if we have timelineStartTime
    // Even if timelineChunks is empty, we should filter terminalResult.chunks by time
    if (timelineChunks.length > 0) {
        console.log('[useTimelineTerminalStream] displayChunks - using timelineChunks', {
          timelineChunksCount: timelineChunks.length,
          currentTimeMs: currentTime,
          timelineStartTime: timelineStartTime ? new Date(timelineStartTime).toISOString() : null,
          targetAbsoluteTime: timelineStartTime ? new Date(timelineStartTime + currentTime).toISOString() : null,
          chunkIndices: timelineChunks.map(c => c.chunkIndex),
          chunkTimestamps: timelineChunks.map(c => ({
            chunkIndex: c.chunkIndex,
            recordedAt: c.recordedAt,
            timestamp: new Date(c.recordedAt).toISOString(),
            timestampMs: new Date(c.recordedAt).getTime(),
          })),
        })
      return timelineChunks
    }
    
    // Fallback: filter terminalResult.chunks by time if timelineStartTime is available
    if (timelineStartTime && currentTime >= 0) {
      const targetAbsoluteTime = getAbsoluteTimeFromTimeline(currentTime)
      if (targetAbsoluteTime) {
        const startAbsoluteTime = new Date(timelineStartTime)
        const filtered = terminalResult.chunks.filter((chunk) => {
          const recordedAt = new Date(chunk.recordedAt)
          return recordedAt >= startAbsoluteTime && recordedAt <= targetAbsoluteTime
        })
        
        console.log('[useTimelineTerminalStream] displayChunks - filtering terminalResult.chunks', {
          currentTimeMs: currentTime,
          startAbsoluteTime: startAbsoluteTime.toISOString(),
          targetAbsoluteTime: targetAbsoluteTime.toISOString(),
          totalChunks: terminalResult.chunks.length,
          filteredChunks: filtered.length,
          chunkIndices: filtered.map(c => c.chunkIndex),
        })
        
        return filtered
      }
    }
    
    // Last resort: return empty array if we can't filter (shouldn't happen in timeline sync mode)
    console.warn('[useTimelineTerminalStream] displayChunks - no chunks available, returning empty', {
      timelineSync,
      playbackMode,
      timelineChunksCount: timelineChunks.length,
      terminalResultChunksCount: terminalResult.chunks.length,
      currentTimeMs: currentTime,
      timelineStartTime,
    })
    
    return []
  }, [timelineSync, playbackMode, timelineChunks, terminalResult.chunks, currentTime, timelineStartTime, getAbsoluteTimeFromTimeline])

  return {
    ...terminalResult,
    chunks: displayChunks,
    timelineChunks: displayChunks,
    isTimelineSync: timelineSync && playbackMode !== 'live',
    isFetchingTimeline,
  }
}
