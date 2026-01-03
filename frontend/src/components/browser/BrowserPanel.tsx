import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Globe,
  X,
  Download,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ============================================================================
// Types
// ============================================================================

export interface BrowserScreenshot {
  name: string
  artifactId?: string
  fileId?: string
  timestamp: string
  url?: string // Download URL
}

export interface BrowserActionStep {
  action: string
  success: boolean
  timestamp: string
  duration: number
  error?: string
  selector?: string
  url?: string
  text?: string
}

export interface BrowserConsoleLog {
  level: 'log' | 'warn' | 'error' | 'debug' | 'info'
  text: string
  timestamp: string
}

export interface BrowserOutput {
  success: boolean
  results: BrowserActionStep[]
  screenshots: BrowserScreenshot[]
  consoleLogs: BrowserConsoleLog[]
  finalUrl?: string
  pageTitle?: string
  error?: string
}

export interface BrowserResultData {
  output: BrowserOutput
  status: 'pending' | 'running' | 'completed' | 'failed'
}

// ============================================================================
// Props
// ============================================================================

interface BrowserPanelProps {
  nodeId: string
  runId: string | null
  data: BrowserResultData | null
  onClose: () => void
  /**
   * Callback to download an artifact by ID
   */
  onDownloadArtifact?: (fileId: string, fileName: string) => Promise<void>
  /**
   * Callback to get artifact download URL
   */
  getArtifactUrl?: (fileId: string) => Promise<string | null>
  /**
   * Called when the panel is focused (for z-index stacking)
   */
  onFocus?: () => void
}

// ============================================================================
// Helpers
// ============================================================================

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const formatTimestamp = (iso: string): string => {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString()
  } catch {
    return iso
  }
}

const getActionLabel = (action: string): string => {
  const labels: Record<string, string> = {
    goto: 'Navigate',
    click: 'Click',
    fill: 'Fill',
    screenshot: 'Screenshot',
    getHTML: 'Get HTML',
    getText: 'Get Text',
    waitFor: 'Wait',
    evaluate: 'Evaluate',
    select: 'Select',
    hover: 'Hover',
    scroll: 'Scroll',
  }
  return labels[action] || action
}

const getActionIcon = (action: string): string => {
  const icons: Record<string, string> = {
    goto: '🌐',
    click: '👆',
    fill: '✏️',
    screenshot: '📸',
    getHTML: '📄',
    getText: '📝',
    waitFor: '⏳',
    evaluate: '🔧',
    select: '📋',
    hover: '🖱️',
    scroll: '📜',
  }
  return icons[action] || '⚙️'
}

const getConsoleLevelColor = (level: string): string => {
  const colors: Record<string, string> = {
    log: 'text-foreground',
    warn: 'text-yellow-500 dark:text-yellow-400',
    error: 'text-red-500 dark:text-red-400',
    debug: 'text-blue-500 dark:text-blue-400',
    info: 'text-cyan-500 dark:text-cyan-400',
  }
  return colors[level] || 'text-foreground'
}

// ============================================================================
// Main Component
// ============================================================================

export function BrowserPanel({
  nodeId,
  data,
  onClose,
  onDownloadArtifact,
  getArtifactUrl,
  onFocus,
}: BrowserPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'screenshots' | 'steps' | 'console'>('screenshots')
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0)
  const [screenshotUrls, setScreenshotUrls] = useState<Record<string, string>>({})
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLoadingUrls, setIsLoadingUrls] = useState(false)

  const output = data?.output
  const screenshots = output?.screenshots ?? []
  const steps = output?.results ?? []
  const consoleLogs = output?.consoleLogs ?? []
  const isRunning = data?.status === 'running'
  const isCompleted = data?.status === 'completed'
  const isFailed = data?.status === 'failed'

  // Load screenshot URLs
  useEffect(() => {
    const loadUrls = async () => {
      if (!getArtifactUrl || screenshots.length === 0) return

      setIsLoadingUrls(true)
      const urls: Record<string, string> = {}

      for (const shot of screenshots) {
        if (shot.fileId && !urls[shot.fileId]) {
          try {
            const url = await getArtifactUrl(shot.fileId)
            if (url) {
              urls[shot.fileId] = url
            }
          } catch (e) {
            console.error(`Failed to load screenshot ${shot.fileId}:`, e)
          }
        }
      }

      setScreenshotUrls(urls)
      setIsLoadingUrls(false)
    }

    void loadUrls()
  }, [screenshots, getArtifactUrl])

  // Focus handling for z-index stacking
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !onFocus) return

    const handlePointerDown = (event: PointerEvent) => {
      if (panel.contains(event.target as Node)) {
        onFocus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    }
  }, [onFocus])

  // Handle keyboard navigation
  useEffect(() => {
    if (!isFullscreen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false)
      } else if (e.key === 'ArrowLeft') {
        setSelectedScreenshotIndex(i => Math.max(0, i - 1))
      } else if (e.key === 'ArrowRight') {
        setSelectedScreenshotIndex(i => Math.min(screenshots.length - 1, i + 1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, screenshots.length])

  // Reset selected screenshot when screenshots change
  useEffect(() => {
    if (screenshots.length > 0 && selectedScreenshotIndex >= screenshots.length) {
      setSelectedScreenshotIndex(Math.max(0, screenshots.length - 1))
    }
  }, [screenshots.length, selectedScreenshotIndex])

  // Download handler
  const handleDownload = useCallback(async (screenshot: BrowserScreenshot) => {
    if (!screenshot.fileId || !onDownloadArtifact) return

    try {
      await onDownloadArtifact(screenshot.fileId, `${screenshot.name}.png`)
    } catch (e) {
      console.error('Failed to download screenshot:', e)
    }
  }, [onDownloadArtifact])

  // Status badge
  const statusBadge = isRunning ? (
    <Badge variant="outline" className="gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" />
      Running
    </Badge>
  ) : isFailed ? (
    <Badge variant="destructive" className="gap-1.5">
      <AlertCircle className="h-3 w-3" />
      Failed
    </Badge>
  ) : isCompleted ? (
    <Badge variant="default" className="gap-1.5 bg-green-600 hover:bg-green-700">
      <CheckCircle2 className="h-3 w-3" />
      Completed
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1.5">
      Pending
    </Badge>
  )

  const selectedScreenshot = screenshots[selectedScreenshotIndex]
  const selectedScreenshotUrl = selectedScreenshot?.fileId
    ? screenshotUrls[selectedScreenshot.fileId]
    : null

  const content = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold">Browser Session</span>
          </div>
          <span className="text-xs text-muted-foreground">{nodeId}</span>
          {statusBadge}
        </div>
        <div className="flex items-center gap-2">
          {output?.finalUrl && (
            <a
              href={output.finalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              {output.finalUrl.length > 40
                ? `${output.finalUrl.slice(0, 40)}...`
                : output.finalUrl}
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b bg-card px-2">
        <TabButton
          active={activeTab === 'screenshots'}
          onClick={() => setActiveTab('screenshots')}
          icon={<ImageIcon className="h-4 w-4" />}
          label="Screenshots"
          count={screenshots.length}
        />
        <TabButton
          active={activeTab === 'steps'}
          onClick={() => setActiveTab('steps')}
          icon={<Terminal className="h-4 w-4" />}
          label="Steps"
          count={steps.length}
        />
        <TabButton
          active={activeTab === 'console'}
          onClick={() => setActiveTab('console')}
          icon={<Terminal className="h-4 w-4" />}
          label="Console"
          count={consoleLogs.length}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-muted/30">
        {activeTab === 'screenshots' && (
          <ScreenshotsTab
            screenshots={screenshots}
            selected={selectedScreenshotIndex}
            onSelect={setSelectedScreenshotIndex}
            selectedUrl={selectedScreenshotUrl}
            screenshotUrls={screenshotUrls}
            isLoading={isLoadingUrls}
            onDownload={handleDownload}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          />
        )}

        {activeTab === 'steps' && (
          <StepsTab steps={steps} />
        )}

        {activeTab === 'console' && (
          <ConsoleTab logs={consoleLogs} />
        )}
      </div>
    </>
  )

  return (
    <>
      <div
        ref={panelRef}
        className={`nodrag nowheel nopan select-text rounded-lg border-2 border-border bg-card overflow-hidden shadow-lg flex flex-col ${isFullscreen ? 'fixed inset-4 z-50' : 'w-[640px] h-[480px]'
          }`}
      >
        {content}
      </div>

      {/* Fullscreen backdrop */}
      {isFullscreen && (
        <div
          className="fixed inset-0 bg-black/80 z-40"
          onClick={() => setIsFullscreen(false)}
        />
      )}
    </>
  )
}

// ============================================================================
// Tab Components
// ============================================================================

interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}

function TabButton({ active, onClick, icon, label, count }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </button>
  )
}

interface ScreenshotsTabProps {
  screenshots: BrowserScreenshot[]
  selected: number
  onSelect: (index: number) => void
  selectedUrl: string | null
  screenshotUrls: Record<string, string>
  isLoading: boolean
  onDownload: (screenshot: BrowserScreenshot) => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

function ScreenshotsTab({
  screenshots,
  selected,
  onSelect,
  selectedUrl,
  screenshotUrls,
  isLoading,
  onDownload,
  isFullscreen,
  onToggleFullscreen,
}: ScreenshotsTabProps) {
  if (screenshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading screenshots...
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <ImageIcon className="h-8 w-8 opacity-50" />
            <span>No screenshots captured</span>
          </div>
        )}
      </div>
    )
  }

  const selectedScreenshot = screenshots[selected]

  return (
    <div className="flex h-full flex-col">
      {/* Main screenshot preview */}
      <div className="flex-1 relative flex items-center justify-center bg-black/50">
        {isLoading && !selectedUrl ? (
          <div className="flex items-center gap-2 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading screenshot...</span>
          </div>
        ) : selectedUrl ? (
          <img
            src={selectedUrl}
            alt={selectedScreenshot.name}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="text-white/50 text-sm">Screenshot not available</div>
        )}

        {/* Navigation arrows */}
        {screenshots.length > 1 && (
          <>
            <button
              onClick={() => onSelect(Math.max(0, selected - 1))}
              disabled={selected === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => onSelect(Math.min(screenshots.length - 1, selected + 1))}
              disabled={selected === screenshots.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Toolbar */}
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <span className="px-2 py-1 rounded bg-black/50 text-white text-xs">
            {selected + 1} / {screenshots.length}
          </span>
          <button
            onClick={onToggleFullscreen}
            className="p-2 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onDownload(selectedScreenshot)}
            className="p-2 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
            disabled={!selectedScreenshot.fileId}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="h-20 border-t bg-card flex items-center gap-2 p-2 overflow-x-auto">
        {screenshots.map((shot, index) => (
          <button
            key={index}
            onClick={() => onSelect(index)}
            className={`relative h-full aspect-video rounded border-2 overflow-hidden flex-shrink-0 transition-colors ${index === selected
              ? 'border-primary'
              : 'border-border hover:border-muted-foreground'
              }`}
          >
            <img
              src={shot.fileId ? screenshotUrls[shot.fileId] : undefined}
              alt={shot.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/70 text-white text-[10px] truncate">
              {shot.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface StepsTabProps {
  steps: BrowserActionStep[]
}

function StepsTab({ steps }: StepsTabProps) {
  if (steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No action steps recorded
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div
            key={index}
            className={`flex items-start gap-3 p-3 rounded-lg border ${step.success
              ? 'bg-background border-border'
              : 'bg-destructive/10 border-destructive/30'
              }`}
          >
            <div className="flex-shrink-0 text-xl">
              {getActionIcon(step.action)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{getActionLabel(step.action)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(step.duration)}
                </span>
                {!step.success && (
                  <Badge variant="destructive" className="text-xs">
                    Failed
                  </Badge>
                )}
              </div>
              {step.selector && (
                <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                  {step.selector}
                </div>
              )}
              {step.url && (
                <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                  {step.url}
                </div>
              )}
              {step.text && (
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {step.text.slice(0, 200)}
                  {step.text.length > 200 ? '...' : ''}
                </div>
              )}
              {step.error && (
                <div className="text-xs text-destructive mt-1">
                  {step.error}
                </div>
              )}
            </div>
            <div className="flex-shrink-0 text-xs text-muted-foreground">
              {formatTimestamp(step.timestamp)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ConsoleTabProps {
  logs: BrowserConsoleLog[]
}

function ConsoleTab({ logs }: ConsoleTabProps) {
  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No console logs captured
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 font-mono text-xs">
      <div className="space-y-1">
        {logs.map((log, index) => (
          <div
            key={index}
            className={`flex gap-2 ${getConsoleLevelColor(log.level)}`}
          >
            <span className="flex-shrink-0 text-muted-foreground">
              {formatTimestamp(log.timestamp)}
            </span>
            <span className="flex-shrink-0 font-semibold min-w-[50px]">
              [{log.level.toUpperCase()}]
            </span>
            <span className="break-all">{log.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
