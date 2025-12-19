import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WorkflowBuilderShellProps {
  mode: 'design' | 'execution'
  topBar: ReactNode
  isLibraryVisible: boolean
  onToggleLibrary: () => void
  libraryContent: ReactNode
  canvasContent: ReactNode
  showScheduleSidebarContainer: boolean
  isScheduleSidebarVisible: boolean
  scheduleSidebarContent?: ReactNode
  isInspectorVisible: boolean
  inspectorContent?: ReactNode
  inspectorWidth: number
  setInspectorWidth: (width: number) => void
  showLoadingOverlay: boolean
  scheduleDrawer?: ReactNode
  runDialog?: ReactNode
}

const LIBRARY_PANEL_WIDTH = 320
const LIBRARY_PANEL_WIDTH_MOBILE = 280

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}

export function WorkflowBuilderShell({
  mode,
  topBar,
  isLibraryVisible,
  onToggleLibrary,
  libraryContent,
  canvasContent,
  showScheduleSidebarContainer,
  isScheduleSidebarVisible,
  scheduleSidebarContent,
  isInspectorVisible,
  inspectorContent,
  inspectorWidth,
  setInspectorWidth,
  showLoadingOverlay,
  scheduleDrawer,
  runDialog,
}: WorkflowBuilderShellProps) {
  const isMobile = useIsMobile()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const inspectorResizingRef = useRef(false)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [showLibraryContent, setShowLibraryContent] = useState(isLibraryVisible)

  // Responsive panel width
  const libraryPanelWidth = isMobile ? LIBRARY_PANEL_WIDTH_MOBILE : LIBRARY_PANEL_WIDTH

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (isLibraryVisible) {
      timeoutId = setTimeout(() => setShowLibraryContent(true), 220)
    } else {
      setShowLibraryContent(false)
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [isLibraryVisible])

  const handleInspectorResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Disable resizing on mobile - use full width instead
      if (mode !== 'execution' || isMobile) {
        return
      }
      inspectorResizingRef.current = true
      setIsInspectorResizing(true)
      document.body.classList.add('select-none')
      event.preventDefault()
    },
    [mode, isMobile],
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!inspectorResizingRef.current || mode !== 'execution') {
        return
      }
      const container = layoutRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const newWidth = rect.right - event.clientX
      setInspectorWidth(newWidth)
    }

    const stopResizing = () => {
      if (inspectorResizingRef.current) {
        inspectorResizingRef.current = false
        setIsInspectorResizing(false)
        document.body.classList.remove('select-none')
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [mode, setInspectorWidth])

  const showLibraryToggleButton = mode === 'design' && !isLibraryVisible

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {topBar}
      <div ref={layoutRef} className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop for library panel */}
        {isMobile && isLibraryVisible && (
          <div
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={onToggleLibrary}
            aria-hidden="true"
          />
        )}

        {showLibraryToggleButton && (
          <Button
            type="button"
            variant="secondary"
            onClick={onToggleLibrary}
            className={cn(
              'absolute z-[60] top-[10px] left-[10px] h-8 px-2 md:px-3 py-1.5',
              'flex items-center gap-1.5 md:gap-2 rounded-md border bg-background',
              'text-xs font-medium transition-all duration-200 hover:bg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            )}
            aria-expanded={false}
            aria-label="Show component library"
            title="Show components"
          >
            <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium whitespace-nowrap hidden sm:inline">Show components</span>
          </Button>
        )}
        {showLoadingOverlay && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
            <svg
              className="animate-spin h-8 w-8 text-muted-foreground"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <p className="mt-3 text-sm text-muted-foreground">Loading workflow…</p>
          </div>
        )}

        {/* Library Panel - Full screen overlay on mobile, side panel on desktop */}
        <aside
          className={cn(
            'h-full border-r bg-background overflow-hidden z-30',
            // Mobile: fixed overlay
            isMobile ? 'fixed left-0 top-0' : 'relative',
            isLibraryVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          style={{
            width: isLibraryVisible ? libraryPanelWidth : 0,
            transition: 'width 200ms ease-in-out, opacity 200ms ease-in-out',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              width: libraryPanelWidth,
              transform: isLibraryVisible ? 'translateX(0)' : `translateX(-${libraryPanelWidth}px)`,
              transition: 'transform 200ms ease-in-out',
            }}
          >
            {isLibraryVisible && (
              <Button
                type="button"
                variant="ghost"
                onClick={onToggleLibrary}
                className={cn(
                  'absolute z-50 top-3 md:top-4 right-3 md:right-4',
                  'h-8 w-8 md:h-7 md:w-7 flex items-center justify-center rounded-md',
                  'text-xs font-medium transition-all duration-200 hover:bg-muted',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                )}
                aria-expanded={true}
                aria-label="Hide component library"
                title="Hide components"
              >
                {isMobile ? (
                  <X className="h-5 w-5" />
                ) : (
                  <PanelLeftClose className="h-4 w-4 flex-shrink-0" />
                )}
              </Button>
            )}
            <div
              className={cn(
                'absolute inset-0',
                showLibraryContent ? 'opacity-100' : 'opacity-0 pointer-events-none select-none',
              )}
              style={{
                transition: 'opacity 200ms ease-in-out',
              }}
            >
              {libraryContent}
            </div>
          </div>
        </aside>

        <main
          className="flex-1 relative flex min-w-0"
          style={{
            transition: isInspectorResizing ? 'none' : 'all 200ms ease-in-out',
          }}
        >
          <div className="flex-1 h-full relative min-w-0">{canvasContent}</div>

          {/* Schedule Sidebar - Hide on mobile, show as drawer instead */}
          {showScheduleSidebarContainer && !isMobile && (
            <aside
              className={cn(
                'overflow-hidden border-l bg-background transition-all duration-150 ease-out',
                isScheduleSidebarVisible
                  ? 'opacity-100 w-[380px] lg:w-[432px]'
                  : 'opacity-0 w-0 pointer-events-none',
              )}
              style={{
                transition: 'width 150ms ease-out, opacity 150ms ease-out',
              }}
            >
              {isScheduleSidebarVisible && scheduleSidebarContent}
            </aside>
          )}

          {/* Inspector Panel - Full width overlay on mobile */}
          {isMobile && isInspectorVisible && (
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => {/* Close inspector on backdrop click - handled by parent */ }}
              aria-hidden="true"
            />
          )}
          <aside
            className={cn(
              'h-full border-l bg-background overflow-hidden',
              // Mobile: fixed full-width overlay
              isMobile ? 'fixed right-0 top-0 z-50' : 'relative',
              isInspectorVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            style={{
              width: isInspectorVisible
                ? (isMobile ? '100%' : inspectorWidth)
                : 0,
              transition: isInspectorResizing
                ? 'opacity 200ms ease-in-out'
                : 'width 200ms ease-in-out, opacity 200ms ease-in-out',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                width: isMobile ? '100%' : inspectorWidth,
              }}
            >
              {/* Resize handle - hidden on mobile */}
              {!isMobile && (
                <div
                  className="absolute top-0 left-0 h-full w-2 cursor-col-resize border-l border-transparent hover:border-primary/40 z-10"
                  onMouseDown={handleInspectorResizeStart}
                />
              )}
              <div className={cn(
                'flex h-full min-h-0 overflow-hidden',
                isMobile ? 'pl-0' : 'pl-2'
              )}>
                {inspectorContent}
              </div>
            </div>
          </aside>
        </main>
      </div>
      {scheduleDrawer}
      {runDialog}
    </div>
  )
}
