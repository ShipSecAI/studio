import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Copy, Download, Loader2, PlugZap, Radio, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTimelineTerminalStream } from '@/hooks/useTimelineTerminalStream'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useThemeStore } from '@/store/themeStore'

interface NodeTerminalPanelProps {
  nodeId: string
  runId: string | null
  onClose: () => void
  /**
   * Enable timeline synchronization mode.
   * When enabled, terminal will update based on timeline position.
   */
  timelineSync?: boolean
  /**
   * Called when the panel is focused (clicked/interacted with).
   * Used for bringing the panel to the front in z-index stacking.
   */
  onFocus?: () => void
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
  onFocus,
}: NodeTerminalPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastRenderedChunkIndex = useRef<number>(-1)
  const lastTimelineTimeRef = useRef<number | null>(null)
  const [terminalKey, setTerminalKey] = useState(0)
  const terminalReadyRef = useRef<boolean>(false)
  const [isTerminalReady, setIsTerminalReady] = useState(false)

  const currentTime = useExecutionTimelineStore((state) => state.currentTime)
  const theme = useThemeStore((state) => state.theme)
  const isDarkMode = theme === 'dark'

  const { chunks, isHydrating, isStreaming, error, mode, exportText, isTimelineSync, isFetchingTimeline, hasData } = useTimelineTerminalStream({
    runId,
    nodeId,
    stream: 'pty',
    autoConnect: true,
    timelineSync,
  })

  const session = useMemo(() => ({ chunks }), [chunks])

  const copyToClipboard = useCallback(async () => {
    if (!chunks.length) return
    const decoded = chunks
      .map((chunk) => {
        try {
          return atob(chunk.payload)
        } catch {
          return ''
        }
      })
      .join('')
    try {
      await navigator.clipboard.writeText(decoded)
    } catch (error) {
      console.error('[NodeTerminalPanel] Failed to copy to clipboard', error)
    }
  }, [chunks])

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    
    // Ensure container has dimensions before opening terminal
    // This prevents xterm.js from trying to access undefined dimensions
    const ensureContainerReady = (callback: () => void) => {
      const container = containerRef.current
      if (!container) return
      
      // Check if container has dimensions
      const rect = container.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        callback()
        return
      }
      
      // If no dimensions yet, wait for next frame and try again
      requestAnimationFrame(() => {
        ensureContainerReady(callback)
      })
    }
    
    ensureContainerReady(() => {
      const container = containerRef.current
      if (!container) return
      
      const term = new Terminal({
        convertEol: false,
        fontSize: 12,
        disableStdin: true,
        cursorBlink: false,
        allowProposedApi: true,
        allowTransparency: false,
        macOptionIsMeta: false,
        macOptionClickForcesSelection: false,
        rightClickSelectsWord: false,
        windowsMode: false,
        theme: {
          // Use dark terminal colors for both light and dark themes (easier to read)
          background: '#1e1e1e', // Dark gray/black for both themes
          foreground: '#d4d4d4', // Light gray text for both themes
          cursor: '#aeafad', // Visible cursor color for both themes
          cursorAccent: '#1e1e1e', // Cursor accent for both themes
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      })

      term.options.macOptionIsMeta = false
      term.options.macOptionClickForcesSelection = false
      term.options.rightClickSelectsWord = false

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      try {
        term.open(container)
      } catch (error) {
        console.warn('[NodeTerminalPanel] Failed to open terminal:', error)
        // If opening fails, dispose and return early
        term.dispose()
        return
      }
      
      terminalRef.current = term
      fitAddonRef.current = fitAddon
      terminalReadyRef.current = false
      setIsTerminalReady(false)

      // Wait for terminal to be fully initialized before fitting
      // Use requestAnimationFrame to ensure DOM and terminal render service are ready
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (fitAddonRef.current && containerRef.current && terminalRef.current === term) {
            try {
              fitAddonRef.current.fit()
              terminalReadyRef.current = true
              setIsTerminalReady(true)
            } catch (error) {
              console.warn('[NodeTerminalPanel] Failed to fit terminal on mount', error)
              // Mark as ready anyway to allow rendering
              terminalReadyRef.current = true
              setIsTerminalReady(true)
            }
          }
        })
      })
    })

    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit()
        } catch (error) {
          // Ignore resize errors during terminal recreation
        }
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      terminalReadyRef.current = false
      setIsTerminalReady(false)
      if (terminalRef.current) {
        terminalRef.current.dispose()
      }
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalKey])

  // Update terminal theme when dark mode changes (without recreating terminal)
  useEffect(() => {
    if (!terminalRef.current || !containerRef.current) return

    terminalRef.current.options.theme = {
      // Use dark terminal colors for both light and dark themes (easier to read)
      background: '#1e1e1e', // Dark gray/black for both themes
      foreground: '#d4d4d4', // Light gray text for both themes
      cursor: '#aeafad', // Visible cursor color for both themes
      cursorAccent: '#1e1e1e', // Cursor accent for both themes
    }
    
    // Update selection color via CSS (xterm.js doesn't support selection in theme)
    // Use standard terminal selection colors
    const styleId = 'xterm-selection-style'
    let styleElement = document.getElementById(styleId) as HTMLStyleElement
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = styleId
      document.head.appendChild(styleElement)
    }
    
    // Use dark mode selection color for both themes
    const selectionBg = '#264f78' // Standard terminal blue selection (works well on dark background)
    
    styleElement.textContent = `
      .xterm .xterm-selection {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top {
        border-top-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom {
        border-bottom-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-left {
        border-left-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-right {
        border-right-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-left,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-right,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-left,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-right {
        background-color: ${selectionBg} !important;
      }
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-left::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-top-right::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-left::before,
      .xterm .xterm-selection .xterm-selection-decoration .xterm-selection-decoration-bottom-right::before {
        background-color: ${selectionBg} !important;
      }
    `
  }, [isDarkMode])

  // SIMPLE RENDERING LOGIC:
  // - Forward: render new chunks incrementally
  // - Backward: reset terminal and render from start to current position
  useEffect(() => {
    // Wait for terminal to be ready (especially after recreation)
    if (!terminalRef.current || !containerRef.current || !terminalReadyRef.current || !chunks || chunks.length === 0 || !isTerminalReady) {
      lastTimelineTimeRef.current = currentTime
      return
    }

    // Detect backward seek
    const isSeekingBackward = timelineSync &&
      lastTimelineTimeRef.current !== null &&
      currentTime < lastTimelineTimeRef.current

    if (isSeekingBackward) {
      // Backward: reset terminal and render all chunks from start
      console.debug('[NodeTerminalPanel] Seeking backward - resetting terminal', {
        from: lastTimelineTimeRef.current,
        to: currentTime,
      })
      
      setTerminalKey(k => k + 1) // Recreate terminal
      lastRenderedChunkIndex.current = -1
      lastTimelineTimeRef.current = currentTime
      return // Terminal will be recreated, this effect will run again
    }

    if (lastRenderedChunkIndex.current === -1) {
      terminalRef.current?.clear()
      terminalRef.current?.reset()
      for (const chunk of chunks) {
        const bytes = decodePayload(chunk.payload)
        if (bytes.length === 0) continue
        terminalRef.current?.write(bytes)
        lastRenderedChunkIndex.current = chunk.chunkIndex
      }
    } else {
      const newChunks = chunks.filter((chunk) => chunk.chunkIndex > lastRenderedChunkIndex.current)
      for (const chunk of newChunks) {
        if (!terminalRef.current) break
        const bytes = decodePayload(chunk.payload)
        if (bytes.length === 0) continue
        terminalRef.current.write(bytes)
        lastRenderedChunkIndex.current = chunk.chunkIndex
      }
    }

    lastTimelineTimeRef.current = currentTime
    
    // Fit terminal after rendering, with safety check
    if (fitAddonRef.current) {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) {
          try {
            fitAddonRef.current.fit()
          } catch (error) {
            // Ignore fit errors during terminal recreation
          }
        }
      })
    }
  }, [chunks, timelineSync, currentTime, terminalKey, isTerminalReady])

  const streamBadge = isTimelineSync ? (
    <span className="flex items-center gap-1 text-xs text-purple-500 dark:text-purple-400">
      <PlugZap className="h-3 w-3" /> Timeline Sync
    </span>
  ) : isStreaming ? (
    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
      <Radio className="h-3 w-3 animate-pulse" /> Live
    </span>
  ) : mode === 'replay' ? (
    <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
      <PlugZap className="h-3 w-3" /> Replay
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <PlugZap className="h-3 w-3" /> Idle
    </span>
  )

  useEffect(() => {
    lastRenderedChunkIndex.current = -1
    lastTimelineTimeRef.current = null
    setTerminalKey((key) => key + 1)
  }, [runId, nodeId])

  // Prevent wheel events from bubbling to ReactFlow (backup to nowheel class)
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handleWheel = (event: WheelEvent) => {
      event.stopPropagation()
    }

    panel.addEventListener('wheel', handleWheel, { capture: false, passive: true })

    return () => {
      panel.removeEventListener('wheel', handleWheel, { capture: false })
    }
  }, [])

  // Handle focus for z-index stacking - listen at document level to catch all clicks
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !onFocus) return

    const handlePointerDown = (event: PointerEvent) => {
      // Check if the click is within this panel
      if (panel.contains(event.target as Node)) {
        onFocus()
      }
    }

    // Listen at document level with capture phase to intercept before any element handles it
    document.addEventListener('pointerdown', handlePointerDown, { capture: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [onFocus])

  return (
    <div
      ref={panelRef}
      // nodrag, nowheel, nopan: Prevent ReactFlow from intercepting mouse events in terminal
      // This fixes sticky selection issues caused by ReactFlow capturing mouse events
      className="nodrag nowheel nopan select-text w-[520px] rounded-lg border-2 border-border bg-card overflow-hidden shadow-lg"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div>
        <div className="text-xs uppercase tracking-wide text-foreground">Live Logs • {nodeId}</div>
          {streamBadge}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground"
            onClick={copyToClipboard}
            disabled={!chunks.length}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground"
            onClick={() => exportText()}
            disabled={!chunks.length}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {(isHydrating || isFetchingTimeline) && (
        <div className="border-b border-border px-3 py-1 flex items-center gap-2 text-[11px] text-muted-foreground bg-card">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{isFetchingTimeline ? 'Loading terminal output...' : 'Loading terminal output...'}</span>
        </div>
      )}
      <div className="relative" style={{ backgroundColor: '#1e1e1e' }}>
        <div ref={containerRef} className="h-[360px] w-full" />
        {!hasData && !session?.chunks?.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-sm text-foreground space-y-2 text-center p-4">
              <div>{isHydrating || isFetchingTimeline ? 'Loading output…' : 'Waiting for terminal output…'}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {nodeId} • pty
              </div>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive border-t border-border bg-destructive/10">
          {error}
        </div>
      )}
    </div>
  )
}
