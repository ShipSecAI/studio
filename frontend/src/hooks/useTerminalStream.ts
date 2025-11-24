import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/services/api'

type TerminalChunk = Awaited<ReturnType<typeof api.executions.getTerminalChunks>>['chunks'][number]

const MAX_BUFFER = 2000

export type TerminalStreamMode = 'idle' | 'live' | 'replay'

export interface UseTerminalStreamOptions {
  runId: string | null | undefined
  nodeId: string
  stream?: 'pty' | 'stdout' | 'stderr'
  autoConnect?: boolean
}

export interface UseTerminalStreamResult {
  chunks: TerminalChunk[]
  isHydrating: boolean
  isStreaming: boolean
  error: string | null
  mode: TerminalStreamMode
  refresh: () => Promise<void>
  fetchMore: () => Promise<void>
  exportText: () => void
}

export function mergeTerminalChunks(
  existing: TerminalChunk[],
  incoming: TerminalChunk[],
  options: { max?: number } = {},
): TerminalChunk[] {
  if (incoming.length === 0) {
    return existing
  }
  const maxSize = options.max ?? MAX_BUFFER
  const map = new Map<number, TerminalChunk>()
  for (const chunk of existing) {
    map.set(chunk.chunkIndex, chunk)
  }
  for (const chunk of incoming) {
    map.set(chunk.chunkIndex, chunk)
  }
  const merged = Array.from(map.values()).sort((a, b) => a.chunkIndex - b.chunkIndex)
  if (merged.length > maxSize) {
    return merged.slice(merged.length - maxSize)
  }
  return merged
}

export function useTerminalStream(options: UseTerminalStreamOptions): UseTerminalStreamResult {
  const { runId, nodeId, stream = 'pty', autoConnect = true } = options
  const [chunks, setChunks] = useState<TerminalChunk[]>([])
  const [isHydrating, setIsHydrating] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<TerminalStreamMode>('idle')
  const cursorRef = useRef<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const pendingRunKey = `${runId ?? 'none'}:${nodeId}:${stream}`

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setIsStreaming(false)
  }, [])

  const hydrate = useCallback(
    async (cursorOverride?: string | null) => {
      if (!runId) {
        return
      }
      setIsHydrating(true)
      setError(null)
      try {
        const result = await api.executions.getTerminalChunks(runId, {
          nodeRef: nodeId,
          stream,
          cursor: cursorOverride ?? undefined,
        })
        cursorRef.current = result.cursor ?? null
        setChunks((prev) =>
          cursorOverride ? mergeTerminalChunks(prev, result.chunks) : result.chunks,
        )
        if (result.chunks.length > 0) {
          setMode(autoConnect ? 'live' : 'replay')
        }
      } catch (err) {
        console.error('[useTerminalStream] hydrate failed', err)
        setError(err instanceof Error ? err.message : 'Failed to load terminal output')
      } finally {
        setIsHydrating(false)
      }
    },
    [runId, nodeId, stream, autoConnect],
  )

  const fetchMore = useCallback(async () => {
    if (!runId || !cursorRef.current) {
      return
    }
    try {
      const result = await api.executions.getTerminalChunks(runId, {
        nodeRef: nodeId,
        stream,
        cursor: cursorRef.current,
      })
      if (result.chunks.length === 0) {
        return
      }
      cursorRef.current = result.cursor ?? cursorRef.current
      setChunks((prev) => mergeTerminalChunks(prev, result.chunks))
      setMode('replay')
    } catch (err) {
      console.error('[useTerminalStream] fetchMore failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load additional chunks')
    }
  }, [runId, nodeId, stream])

  const exportText = useCallback(() => {
    if (!chunks.length) {
      return
    }
    const decoded = chunks
      .map((chunk) => {
        try {
          return atob(chunk.payload)
        } catch {
          return `[${chunk.chunkIndex}]`
        }
      })
      .join('')
    const blob = new Blob([decoded], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `terminal-${nodeId}-${stream}-${Date.now()}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [chunks, nodeId, stream])

  useEffect(() => {
    // Reset state when runId/nodeId/stream changes
    setChunks([])
    cursorRef.current = null
    setMode('idle')
    setError(null)
    closeStream()
    if (!runId) {
      return
    }
    // Hydrate will load existing chunks, then SSE will connect for live updates
    void hydrate()
  }, [pendingRunKey, runId, hydrate, closeStream])
  
  // Separate effect to ensure SSE connects after hydration completes
  useEffect(() => {
    // If we have chunks but SSE isn't connected and autoConnect is true, ensure connection
    if (runId && autoConnect && chunks.length > 0 && !isStreaming && mode === 'live') {
      console.debug('[useTerminalStream] chunks exist but SSE not connected, ensuring connection', {
        runId,
        chunksCount: chunks.length,
      })
      // The SSE connection effect should handle this, but let's make sure it triggers
    }
  }, [runId, autoConnect, chunks.length, isStreaming, mode])

  useEffect(() => {
    if (!runId || !autoConnect) {
      console.debug('[useTerminalStream] SSE connection skipped', { runId, autoConnect })
      return
    }

    let isMounted = true
    let source: EventSource | null = null

    const connect = async () => {
      try {
        console.debug('[useTerminalStream] connecting to SSE', { runId, nodeId, stream, cursor: cursorRef.current })
        source = await api.executions.stream(runId, {
          terminalCursor: cursorRef.current ?? undefined,
        })
        if (!isMounted) {
          source.close()
          return
        }
        eventSourceRef.current = source
        setIsStreaming(true)
        setMode((prev) => (prev === 'idle' ? 'live' : prev))
        console.debug('[useTerminalStream] SSE connected successfully', { runId, nodeId, stream })

        const handleTerminal = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as Awaited<
              ReturnType<typeof api.executions.getTerminalChunks>
            >
            console.debug('[useTerminalStream] terminal SSE event received', {
              totalChunks: payload.chunks?.length,
              nodeId,
              stream,
              cursor: payload.cursor,
            })
            if (!payload.chunks?.length) {
              console.debug('[useTerminalStream] no chunks in payload')
              return
            }
            const relevant = payload.chunks.filter(
              (chunk) => chunk.nodeRef === nodeId && chunk.stream === stream,
            )
            console.debug('[useTerminalStream] filtered chunks', {
              relevantCount: relevant.length,
              totalCount: payload.chunks.length,
              nodeRefs: payload.chunks.map(c => c.nodeRef),
              streams: payload.chunks.map(c => c.stream),
            })
            if (relevant.length === 0) {
              console.debug('[useTerminalStream] no relevant chunks for nodeId/stream')
              return
            }
            cursorRef.current = payload.cursor ?? cursorRef.current
            setChunks((prev) => {
              const merged = mergeTerminalChunks(prev, relevant)
              console.debug('[useTerminalStream] updating chunks', {
                prevCount: prev.length,
                newCount: relevant.length,
                mergedCount: merged.length,
                lastChunkIndex: merged[merged.length - 1]?.chunkIndex,
              })
              return merged
            })
            setMode('live')
          } catch (err) {
            console.error('[useTerminalStream] failed to parse terminal SSE', err)
          }
        }

        const handleComplete = () => {
          setIsStreaming(false)
          setMode('replay')
          source?.close()
        }

        source.addEventListener('terminal', handleTerminal)
        source.addEventListener('complete', handleComplete)
        source.addEventListener('error', (event) => {
          console.error('[useTerminalStream] SSE error event', event)
          setIsStreaming(false)
        })
        source.addEventListener('open', () => {
          console.debug('[useTerminalStream] SSE connection opened')
        })
        source.addEventListener('ready', (event) => {
          console.debug('[useTerminalStream] SSE ready event', event)
        })
      } catch (err) {
        if (isMounted) {
          console.error('[useTerminalStream] SSE connection failed', err)
          setError('Failed to connect to terminal stream')
          setIsStreaming(false)
        }
      }
    }

    void connect()

    return () => {
      isMounted = false
      source?.close()
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null
      }
      setIsStreaming(false)
    }
  }, [runId, nodeId, stream, autoConnect])

  const refresh = useCallback(async () => {
    await hydrate(cursorRef.current)
  }, [hydrate])

  return useMemo(
    () => ({
      chunks,
      isHydrating,
      isStreaming,
      error,
      mode,
      refresh,
      fetchMore,
      exportText,
    }),
    [chunks, isHydrating, isStreaming, error, mode, refresh, fetchMore, exportText],
  )
}
