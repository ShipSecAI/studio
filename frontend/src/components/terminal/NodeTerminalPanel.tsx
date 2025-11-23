import { useEffect, useMemo, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Download, Loader2, PlugZap, Radio, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTimelineTerminalStream } from '@/hooks/useTimelineTerminalStream'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'

type TerminalChunk = {
  nodeRef: string;
  stream: string;
  chunkIndex: number;
  payload: string;
  recordedAt: string;
  deltaMs?: number;
  origin?: string;
  runnerKind?: string;
};

interface NodeTerminalPanelProps {
  nodeId: string
  runId: string | null
  onClose: () => void
  /**
   * Enable timeline synchronization mode.
   * When enabled, terminal will update based on timeline position.
   */
  timelineSync?: boolean
}

const decodePayload = (payload: string): Uint8Array => {
  if (typeof window === 'undefined' || typeof atob !== 'function') {
    return new Uint8Array(0)
  }
  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    // Return raw bytes instead of decoded string to preserve control characters
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

export function NodeTerminalPanel({
  nodeId,
  runId,
  onClose,
  timelineSync = false,
}: NodeTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastRenderedChunkIndex = useRef<number>(-1)
  const lastTimelineTimeRef = useRef<number | null>(null)

  // Use separate selectors to avoid creating new objects on every render
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode)
  const currentTime = useExecutionTimelineStore((state) => state.currentTime)

  const { chunks, isHydrating, isStreaming, error, mode, exportText, isTimelineSync, isFetchingTimeline } = useTimelineTerminalStream({
    runId,
    nodeId,
    stream: 'pty', // Always use PTY stream
    autoConnect: !timelineSync || playbackMode === 'live', // Only auto-connect in live mode or when not syncing
    timelineSync,
  })

  // Timing-aware rendering refs
  const replayTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const replayQueueRef = useRef<TerminalChunk[]>([])
  const isReplayingRef = useRef(false)

  // Memoize session to avoid unnecessary re-renders
  // Only depend on chunks length and last chunk index, not the entire chunks array
  const chunksLength = chunks.length
  const lastChunkIndex = chunks[chunksLength - 1]?.chunkIndex ?? -1
  const session = useMemo(
    () => {
      console.debug('[NodeTerminalPanel] session memo updated', {
        chunksCount: chunksLength,
        lastChunkIndex,
        mode,
        isStreaming,
        isTimelineSync,
      })
      return {
        chunks,
      }
    },
    [chunks, chunksLength, lastChunkIndex, mode, isStreaming, isTimelineSync],
  )

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const term = new Terminal({
      convertEol: false, // Don't convert EOL - we want raw control characters
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      allowProposedApi: true,
      allowTransparency: false,
      // Disable selection and mouse events
      macOptionIsMeta: false,
      macOptionClickForcesSelection: false,
      rightClickSelectsWord: false,
      // Enable proper handling of control characters
      windowsMode: false,
      theme: {
        background: '#0f172a',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    })
    
    // Disable mouse events completely to prevent selection mode
    term.options.macOptionIsMeta = false
    term.options.macOptionClickForcesSelection = false
    term.options.rightClickSelectsWord = false

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    setTimeout(() => fitAddon.fit(), 0)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null

      // Clear any pending replay timeouts
      if (replayTimeoutRef.current) {
        clearTimeout(replayTimeoutRef.current)
        replayTimeoutRef.current = null
      }
    }
  }, [])

  // Clear any pending replay timeouts when mode changes
  useEffect(() => {
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current)
      replayTimeoutRef.current = null
    }
    replayQueueRef.current = []
    isReplayingRef.current = false
  }, [mode])

  // TIMELINE SYNC: Handle timeline position changes (asciinema-style full rebuild)
  useEffect(() => {
    if (!isTimelineSync || !terminalRef.current) {
      return
    }

    // Detect if we're seeking backward (like asciinema does)
    const isSeekingBackward = lastTimelineTimeRef.current !== null && currentTime < lastTimelineTimeRef.current

    if (isSeekingBackward) {
      // Seeking backward: Clear terminal and rebuild from scratch (asciinema approach)
      console.debug('[NodeTerminalPanel] Seeking backward - clearing terminal', {
        from: lastTimelineTimeRef.current,
        to: currentTime,
      })
      terminalRef.current.clear() // Equivalent to asciinema's feed("\x1bc")
      lastRenderedChunkIndex.current = -1
    }

    lastTimelineTimeRef.current = currentTime
  }, [isTimelineSync, currentTime])

  // Render chunks to terminal
  useEffect(() => {
    if (!terminalRef.current) {
      console.debug('[NodeTerminalPanel] terminal ref not ready, skipping chunk write')
      return
    }
    
    if (!chunks || chunks.length === 0) {
      return
    }

    // In timeline sync mode, always rebuild from scratch (fast-forward, no delays)
    if (isTimelineSync) {
      // Clear terminal if we haven't rendered anything yet
      if (lastRenderedChunkIndex.current === -1) {
        terminalRef.current.clear()
      }

      // Fast-forward: apply all chunks up to current position (no timing delays)
      const chunksToRender = chunks.filter(
        (chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current,
      )

      console.debug('[NodeTerminalPanel] Timeline sync - fast-forward rendering', {
        totalChunks: chunks.length,
        chunksToRender: chunksToRender.length,
        lastRenderedIndex: lastRenderedChunkIndex.current,
        currentTime,
      })

      for (const chunk of chunksToRender) {
        if (!terminalRef.current) break
        const bytes = decodePayload(chunk.payload)
        if (bytes.length === 0) continue
        terminalRef.current.write(bytes)
        lastRenderedChunkIndex.current = chunk.chunkIndex
      }

      fitAddonRef.current?.fit()
      return
    }

    // Regular live/replay mode (existing logic)
    const newChunks = chunks.filter(
      (chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current,
    )

    console.debug('[NodeTerminalPanel] chunks effect triggered', {
      totalChunks: chunks.length,
      newChunksCount: newChunks.length,
      lastRenderedIndex: lastRenderedChunkIndex.current,
      mode,
      isStreaming,
      isTimelineSync,
      terminalReady: !!terminalRef.current,
    })

    if (newChunks.length === 0) {
      return
    }

    const processChunk = (chunk: TerminalChunk) => {
      if (!terminalRef.current) return

      const bytes = decodePayload(chunk.payload)
      // Write raw bytes directly to preserve control characters like \r
      terminalRef.current.write(bytes)
      lastRenderedChunkIndex.current = chunk.chunkIndex

      // Process next chunk in queue if exists
      if (replayQueueRef.current.length > 0) {
        const nextChunk = replayQueueRef.current.shift()
        if (nextChunk) {
          const delay = nextChunk.deltaMs || 100 // Default 100ms if no deltaMs
          replayTimeoutRef.current = setTimeout(() => processChunk(nextChunk), delay)
        }
      } else {
        // No more chunks, replay complete
        isReplayingRef.current = false
      }

      fitAddonRef.current?.fit()
    }

    // Always write chunks in live mode, regardless of isStreaming status
    // Chunks can come from hydration or SSE, both should be displayed
    if (mode === 'live') {
      // Live mode: display chunks immediately
      console.debug('[NodeTerminalPanel] writing chunks in live mode', {
        chunksToWrite: newChunks.length,
        terminalExists: !!terminalRef.current,
        isStreaming,
        mode,
      })
      for (const chunk of newChunks) {
        if (!terminalRef.current) {
          console.warn('[NodeTerminalPanel] terminal ref is null, cannot write chunk', chunk.chunkIndex)
          break
        }
        const bytes = decodePayload(chunk.payload)
        if (bytes.length === 0) {
          console.warn('[NodeTerminalPanel] decoded bytes are empty for chunk', chunk.chunkIndex)
          continue
        }
        terminalRef.current.write(bytes)
        lastRenderedChunkIndex.current = chunk.chunkIndex
        console.debug('[NodeTerminalPanel] wrote chunk', {
          chunkIndex: chunk.chunkIndex,
          bytesLength: bytes.length,
          payloadPreview: chunk.payload.substring(0, 50),
        })
      }
      fitAddonRef.current?.fit()
    } else if (isStreaming && (mode === 'idle' || mode === 'replay')) {
      // If streaming but not in live mode, still write chunks immediately
      console.debug('[NodeTerminalPanel] writing chunks while streaming', {
        chunksToWrite: newChunks.length,
        mode,
        isStreaming,
      })
      for (const chunk of newChunks) {
        if (!terminalRef.current) break
        const bytes = decodePayload(chunk.payload)
        if (bytes.length === 0) continue
        terminalRef.current.write(bytes)
        lastRenderedChunkIndex.current = chunk.chunkIndex
      }
      fitAddonRef.current?.fit()
    } else if (mode === 'replay' && !isReplayingRef.current) {
      // Replay mode: display chunks with timing delays
      isReplayingRef.current = true
      replayQueueRef.current = [...newChunks] // Copy array

      // Start replay with first chunk
      const firstChunk = replayQueueRef.current.shift()
      if (firstChunk) {
        const delay = firstChunk.deltaMs || 100 // Default 100ms if no deltaMs
        replayTimeoutRef.current = setTimeout(() => processChunk(firstChunk), delay)
      }
    }
  }, [chunks, mode, isStreaming, isTimelineSync, currentTime])

  const streamBadge = isTimelineSync ? (
    <span className="flex items-center gap-1 text-xs text-purple-400">
      <PlugZap className="h-3 w-3" /> Timeline Sync
    </span>
  ) : isStreaming ? (
    <span className="flex items-center gap-1 text-xs text-green-400">
      <Radio className="h-3 w-3 animate-pulse" /> Live
    </span>
  ) : mode === 'replay' ? (
    <span className="flex items-center gap-1 text-xs text-blue-400">
      <PlugZap className="h-3 w-3" /> {isReplayingRef.current ? 'Playing...' : 'Replay'}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-slate-400">
      <PlugZap className="h-3 w-3" /> Idle
    </span>
  )

  return (
    <div className="w-[520px] bg-slate-900 text-slate-100 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950/70">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-300">Terminal • {nodeId}</div>
          {streamBadge}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-slate-100"
            onClick={() => exportText()}
            disabled={!chunks.length}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {(isHydrating || isFetchingTimeline) && (
        <div className="border-b border-slate-800 px-3 py-1 flex items-center gap-2 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{isFetchingTimeline ? 'Syncing with timeline...' : 'Loading terminal output...'}</span>
        </div>
      )}
      <div className="relative bg-slate-950">
        <div ref={containerRef} className="h-[360px] w-full" />
        {!session?.chunks?.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-xs text-slate-500 space-y-2 text-center p-4">
              <div>{isHydrating || isFetchingTimeline ? 'Loading output…' : 'Waiting for terminal output…'}</div>
              <div className="font-mono text-[10px] opacity-50">
                {nodeId} • pty
              </div>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 border-t border-slate-800 bg-slate-950/60">
          {error}
        </div>
      )}
    </div>
  )
}
