import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
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
    return ''
  }
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return String.fromCharCode(...bytes)
  }
}

export function NodeTerminalPanel({ nodeId, stream = 'pty', onClose }: NodeTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const lastRenderedChunkIndex = useRef<number>(0)

  const session = useExecutionStore((state) => state.getTerminalSession(nodeId, stream))

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
    })
    term.open(containerRef.current)
    terminalRef.current = term
    return () => {
      term.dispose()
      terminalRef.current = null
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
    newChunks.forEach((chunk) => {
      const decoded = decodePayload(chunk.payload)
      terminalRef.current?.write(decoded)
      lastRenderedChunkIndex.current = chunk.chunkIndex
    })
  }, [session?.chunks])

  useEffect(() => {
    if (!session) {
      lastRenderedChunkIndex.current = 0
      terminalRef.current?.reset()
    }
  }, [session])

  return (
    <div className="w-[360px] bg-slate-900 text-slate-100 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950/70">
        <div className="text-xs uppercase tracking-wide text-slate-300">Terminal • {nodeId}</div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className={cn('p-2 bg-slate-950/50', 'max-h-[240px] min-h-[200px] overflow-auto')}>
        <div ref={containerRef} className="h-[200px]" />
        {!session?.chunks?.length && (
          <div className="text-xs text-slate-400 mt-2">Waiting for terminal output…</div>
        )}
      </div>
    </div>
  )
}
