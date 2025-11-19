import { useEffect, useMemo, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { X } from 'lucide-react'
import { useExecutionStore } from '@/store/executionStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NodeTerminalPanelProps {
  nodeId: string
  stream?: 'pty' | 'stdout' | 'stderr'
  onClose: () => void
}

const decodePayload = (payload: string): string => {
  if (typeof window === 'undefined' || typeof atob !== 'function') {
    console.warn('[NodeTerminalPanel] cannot decode payload in non-browser environment')
    return ''
  }
  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    console.debug('[NodeTerminalPanel] payload decode success', {
      payloadLength: payload.length,
      binaryLength: binary.length,
      decodedLength: decoded.length,
      decodedPreview: decoded.substring(0, 200),
    })
    return decoded
  } catch (error) {
    console.error('[NodeTerminalPanel] payload decode failed', { error, payloadLength: payload.length })
    try {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return String.fromCharCode(...bytes)
    } catch (fallbackError) {
      console.error('[NodeTerminalPanel] fallback decode also failed', { fallbackError })
      return `[DECODE_ERROR: ${payload.length} bytes]`
    }
  }
}

const terminalKey = (nodeRef: string, stream: string) => `${nodeRef}:${stream}`

export function NodeTerminalPanel({ nodeId, stream = 'pty', onClose }: NodeTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastRenderedChunkIndex = useRef<number>(-1)

  const sessionKey = useMemo(() => terminalKey(nodeId, stream), [nodeId, stream])
  const session = useExecutionStore((state) => state.terminalStreams[sessionKey])
  const streamingMode = useExecutionStore((state) => state.streamingMode)
  const runId = useExecutionStore((state) => state.runId)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const term = new Terminal({
      convertEol: true,
      fontSize: 12,
      disableStdin: true,
      cursorBlink: false,
      theme: {
        background: '#0f172a',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Handle resize
    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    // Initial fit after a short delay to ensure container is rendered
    setTimeout(() => fitAddon.fit(), 0)

    return () => {
      window.removeEventListener('resize', handleResize)
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!terminalRef.current || !session?.chunks) {
      return
    }
    const newChunks = session.chunks.filter((chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current)
    if (newChunks.length === 0) {
      return
    }

    console.debug('[NodeTerminalPanel] processing new chunks', {
      nodeId,
      stream,
      newChunksCount: newChunks.length,
      lastIndex: lastRenderedChunkIndex.current,
      firstNewIndex: newChunks[0]?.chunkIndex,
    })

    newChunks.forEach((chunk) => {
      const decoded = decodePayload(chunk.payload)
      console.debug('[NodeTerminalPanel] writing chunk to terminal', {
        nodeId,
        chunkIndex: chunk.chunkIndex,
        decodedLength: decoded.length,
        decodedPreview: decoded.substring(0, 200),
        hasCarriageReturn: decoded.includes('\r'),
        hasNewline: decoded.includes('\n'),
      })
      terminalRef.current?.write(decoded)
      lastRenderedChunkIndex.current = chunk.chunkIndex
    })

    // Re-fit on new content just in case
    fitAddonRef.current?.fit()
  }, [session?.chunks, sessionKey])

  useEffect(() => {
    if (session?.chunks?.length) {
      const lastChunk = session.chunks[session.chunks.length - 1]
      console.debug('[NodeTerminalPanel] chunk received', {
        nodeId,
        stream,
        count: session.chunks.length,
        chunkIndex: lastChunk?.chunkIndex,
        recordedAt: lastChunk?.recordedAt,
      })

      // Debug: Log payload content for first few chunks
      if (session.chunks.length <= 3) {
        console.debug('[NodeTerminalPanel] chunk payload details', {
          chunkIndex: lastChunk?.chunkIndex,
          payloadLength: lastChunk?.payload?.length,
          payloadPreview: lastChunk?.payload?.substring(0, 100),
          decodedPreview: decodePayload(lastChunk?.payload || '').substring(0, 100),
        })
      }
    }
  }, [session?.chunks])

  useEffect(() => {
    if (!session) {
      lastRenderedChunkIndex.current = -1
      terminalRef.current?.reset()
    }
  }, [session])

  return (
    <div className="w-[480px] bg-slate-900 text-slate-100 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950/70">
        <div className="text-xs uppercase tracking-wide text-slate-300">Terminal • {nodeId}</div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative bg-slate-950">
        <div ref={containerRef} className="h-[320px] w-full" />
        {!session?.chunks?.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-xs text-slate-500 space-y-2 text-center p-4">
              <div>Waiting for terminal output…</div>
              <div className="font-mono text-[10px] opacity-50">
                {nodeId} • {stream}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
