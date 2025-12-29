import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, X, Undo2, Redo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import { HumanInputDialog } from './HumanInputDialog'

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
  isConfigPanelVisible?: boolean
  configPanelContent?: ReactNode
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const LIBRARY_PANEL_WIDTH = 320
const LIBRARY_PANEL_WIDTH_MOBILE = 280



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
  isConfigPanelVisible,
  configPanelContent,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: WorkflowBuilderShellProps) {
  const isMobile = useIsMobile()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const inspectorResizingRef = useRef(false)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [showLibraryContent, setShowLibraryContent] = useState(isLibraryVisible)

  // Mobile bottom sheet state
  const [mobileSheetHeight, setMobileSheetHeight] = useState(80) // percentage of available height
  const isDraggingSheetRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(50)
  const [showMobileHint, setShowMobileHint] = useState(true)

  // Responsive panel width
  const libraryPanelWidth = isMobile ? LIBRARY_PANEL_WIDTH_MOBILE : LIBRARY_PANEL_WIDTH

  // Reset hint when any panel becomes visible on mobile
  const anyMobilePanelVisible = isInspectorVisible || isConfigPanelVisible || isScheduleSidebarVisible

  useEffect(() => {
    if (isMobile && anyMobilePanelVisible) {
      setShowMobileHint(true)
    }
  }, [isMobile, anyMobilePanelVisible])

  // Auto-hide mobile hint after 2 seconds
  useEffect(() => {
    if (isMobile && anyMobilePanelVisible && showMobileHint) {
      const timer = setTimeout(() => {
        setShowMobileHint(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [isMobile, anyMobilePanelVisible, showMobileHint])

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

  // Mobile bottom sheet drag handlers
  const handleSheetDragStart = useCallback((clientY: number) => {
    isDraggingSheetRef.current = true
    dragStartYRef.current = clientY
    dragStartHeightRef.current = mobileSheetHeight
    document.body.classList.add('select-none')
  }, [mobileSheetHeight])

  const handleSheetDragMove = useCallback((clientY: number) => {
    if (!isDraggingSheetRef.current) return

    const availableHeight = window.innerHeight - 56 // subtract topbar height
    const deltaY = dragStartYRef.current - clientY
    const deltaPercent = (deltaY / availableHeight) * 100
    const newHeight = Math.min(85, Math.max(5, dragStartHeightRef.current + deltaPercent))
    setMobileSheetHeight(newHeight)
  }, [])

  const handleSheetDragEnd = useCallback(() => {
    if (!isDraggingSheetRef.current) return
    isDraggingSheetRef.current = false
    document.body.classList.remove('select-none')

    // Snap to nearest position (5% collapsed, 50% half, or 80% expanded)
    const snapPoints = [5, 50, 80]
    const closest = snapPoints.reduce((prev, curr) =>
      Math.abs(curr - mobileSheetHeight) < Math.abs(prev - mobileSheetHeight) ? curr : prev
    )
    setMobileSheetHeight(closest)
  }, [mobileSheetHeight])

  // Touch event handlers for mobile sheet
  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    const touch = e.touches[0]
    if (touch) handleSheetDragStart(touch.clientY)
  }, [handleSheetDragStart])

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    const touch = e.touches[0]
    if (touch) handleSheetDragMove(touch.clientY)
  }, [handleSheetDragMove])

  const handleSheetTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation()
    handleSheetDragEnd()
  }, [handleSheetDragEnd])

  // Mouse event handlers for mobile sheet (for testing on desktop)
  const handleSheetMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    handleSheetDragStart(e.clientY)
  }, [handleSheetDragStart])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSheetRef.current) {
        handleSheetDragMove(e.clientY)
      }
    }
    const handleMouseUp = () => {
      if (isDraggingSheetRef.current) {
        handleSheetDragEnd()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleSheetDragMove, handleSheetDragEnd])

  const showLibraryToggleButton = mode === 'design' && !isLibraryVisible

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {topBar}
      <div ref={layoutRef} className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop for library panel */}
        {isMobile && isLibraryVisible && (
          <div
            className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm md:hidden"
            onClick={onToggleLibrary}
            aria-hidden="true"
          />
        )}

        {showLibraryToggleButton && (
          <div className="absolute z-[35] top-[10px] left-[10px] flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={onToggleLibrary}
              className={cn(
                'h-8 px-2 md:px-3 py-1.5',
                'flex items-center gap-1.5 md:gap-2 rounded-md border bg-background',
                'text-xs font-medium transition-all duration-200 hover:bg-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-sm'
              )}
              aria-expanded={false}
              aria-label="Show component library"
              title="Show components"
            >
              <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium whitespace-nowrap hidden sm:inline">Show components</span>
            </Button>

            {isMobile && mode === 'design' && (
              <div className="flex items-center gap-1 bg-background border rounded-md px-1 h-8 shadow-sm">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onUndo}
                  disabled={!canUndo}
                  aria-label="Undo"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
                <div className="h-3.5 w-px bg-border mx-0.5" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onRedo}
                  disabled={!canRedo}
                  aria-label="Redo"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
        {showLoadingOverlay && (
          <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
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
            'h-full border-r bg-background overflow-hidden z-[60]',
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
                  ? 'opacity-100 w-[432px]'
                  : 'opacity-0 w-0 pointer-events-none',
              )}
              style={{
                transition: 'width 150ms ease-out, opacity 150ms ease-out',
              }}
            >
              {isScheduleSidebarVisible && scheduleSidebarContent}
            </aside>
          )}

          {/* Mobile: Draggable bottom sheet for all panels */}
          {isMobile ? (
            <aside
              className={cn(
                'fixed inset-x-0 bottom-0 z-[60] bg-background border-t rounded-t-2xl shadow-2xl overflow-hidden',
                'transition-opacity duration-200',
                anyMobilePanelVisible ? 'opacity-100' : 'opacity-0 pointer-events-none translate-y-full',
              )}
              style={{
                height: anyMobilePanelVisible ? `${mobileSheetHeight}%` : 0,
                maxHeight: 'calc(100vh - 56px)', // Don't go above topbar
                transition: isDraggingSheetRef.current
                  ? 'none'
                  : 'height 200ms ease-out, opacity 200ms ease-out, transform 200ms ease-out',
              }}
            >
              {/* Drag handle with animated hint */}
              <div
                className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none select-none"
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
                onMouseDown={handleSheetMouseDown}
              >
                <div
                  className={cn(
                    'flex items-center justify-center rounded-full transition-all duration-500 ease-out overflow-hidden',
                    showMobileHint
                      ? 'bg-muted/80 border px-3 py-1.5 gap-1.5'
                      : 'bg-muted-foreground/40 w-12 h-1.5'
                  )}
                >
                  {showMobileHint ? (
                    <>
                      <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {isConfigPanelVisible ? 'Slide down to see canvas' :
                          isScheduleSidebarVisible ? 'Slide down to see canvas' :
                            'Slide down to inspect nodes'}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Content */}
              <div className="flex h-[calc(100%-36px)] min-h-0 overflow-hidden w-full relative">
                {isConfigPanelVisible ? configPanelContent :
                  isScheduleSidebarVisible ? scheduleSidebarContent :
                    inspectorContent}
                <div id="mobile-bottom-sheet-portal" className="absolute inset-0 empty:hidden" />
              </div>
            </aside>
          ) : (
            // Desktop: Side panel (unchanged)
            <aside
              className={cn(
                'border-l bg-background overflow-hidden relative h-full',
                isInspectorVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
              )}
              style={{
                width: isInspectorVisible ? inspectorWidth : 0,
                transition: isInspectorResizing
                  ? 'opacity 200ms ease-in-out'
                  : 'width 200ms ease-in-out, opacity 200ms ease-in-out',
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  width: inspectorWidth,
                }}
              >
                {/* Resize handle */}
                <div
                  className="absolute top-0 left-0 h-full w-2 cursor-col-resize border-l border-transparent hover:border-primary/40 z-10"
                  onMouseDown={handleInspectorResizeStart}
                />
                <div className="flex h-full min-h-0 overflow-hidden pl-2">
                  {inspectorContent}
                </div>
              </div>
            </aside>
          )}
        </main>
      </div>
      {scheduleDrawer}
      {runDialog}
      <HumanInputDialog />
    </div>
  )
}
