import { useEffect, useMemo, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Download, Loader2, PlugZap, Radio, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTerminalStream } from '@/hooks/useTerminalStream'

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
}: NodeTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastRenderedChunkIndex = useRef<number>(-1)

  const { chunks, isHydrating, isStreaming, error, mode, exportText } = useTerminalStream({
    runId,
    nodeId,
    stream: 'pty', // Always use PTY stream
    autoConnect: true, // Enable automatic SSE connection for live streaming
  })

  // Timing-aware rendering refs
  const replayTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const replayQueueRef = useRef<TerminalChunk[]>([])
  const isReplayingRef = useRef(false)

  const session = useMemo(
    () => {
      console.debug('[NodeTerminalPanel] session memo updated', {
        chunksCount: chunks.length,
        lastChunkIndex: chunks[chunks.length - 1]?.chunkIndex,
        mode,
        isStreaming,
      })
      return {
        chunks,
      }
    },
    [chunks, mode, isStreaming],
  )


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

  // Clear any pending replay timeouts when mode changes (not chunks, to avoid interrupting live updates)
  useEffect(() => {
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current)
      replayTimeoutRef.current = null
    }
    replayQueueRef.current = []
    isReplayingRef.current = false
  }, [mode]) // Only clear on mode change, not chunks change

  // Use chunks directly instead of session.chunks to ensure effect triggers
  useEffect(() => {
    if (!terminalRef.current) {
      console.debug('[NodeTerminalPanel] terminal ref not ready, skipping chunk write')
      return
    }
    
    if (!chunks || chunks.length === 0) {
      return
    }

    const newChunks = chunks.filter(
      (chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current,
    )
    console.debug('[NodeTerminalPanel] chunks effect triggered', {
      totalChunks: chunks.length,
      newChunksCount: newChunks.length,
      lastRenderedIndex: lastRenderedChunkIndex.current,
      mode,
      isStreaming,
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
      // Write all chunks at once for immediate rendering
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
  }, [chunks, mode, isStreaming]) // Use chunks directly, not session.chunks


  const streamBadge = isStreaming ? (
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
      {isHydrating && (
        <div className="border-b border-slate-800 px-3 py-1 flex items-center gap-2 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Loading terminal output...</span>
        </div>
      )}
      <div className="relative bg-slate-950">
        <div ref={containerRef} className="h-[360px] w-full" />
        {!session?.chunks?.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-xs text-slate-500 space-y-2 text-center p-4">
              <div>{isHydrating ? 'Hydrating output…' : 'Waiting for terminal output…'}</div>
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
