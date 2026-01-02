import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SetStateAction } from 'react'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import { Canvas } from '@/components/workflow/Canvas'
import { WorkflowSchedulesSummaryBar, WorkflowSchedulesSidebar } from '@/components/workflow/WorkflowSchedulesPanel'
import { WorkflowWebhooksSidebar } from '@/components/workflow/WorkflowWebhooksPanel'
import type { FrontendNodeData } from '@/schemas/node'
import { WorkflowSchedulesProvider } from '@/features/workflow-builder/contexts/WorkflowSchedulesContext'
import { useWorkflowSchedules } from '@/features/workflow-builder/hooks/useWorkflowSchedules'
import { ScheduleEditorDrawer } from '@/components/schedules/ScheduleEditorDrawer'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { API_BASE_URL } from '@/services/api'

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

type SetNodesFn = (setter: SetStateAction<ReactFlowNode<FrontendNodeData>[]>) => void
type SetEdgesFn = (setter: SetStateAction<ReactFlowEdge[]>) => void

interface WorkflowDesignerPaneProps {
  workflowId: string | null | undefined
  workflowName: string
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
  setNodes: SetNodesFn
  setEdges: SetEdgesFn
  onNodesChange: (changes: any[]) => void
  onEdgesChange: (changes: any[]) => void
  showSummary?: boolean
  onNavigateToSchedules: () => void
  onCaptureSnapshot?: (nodes?: ReactFlowNode<FrontendNodeData>[], edges?: ReactFlowEdge[]) => void
}

export function WorkflowDesignerPane({
  workflowId,
  workflowName,
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  showSummary = true,
  onNavigateToSchedules,
  onCaptureSnapshot,
}: WorkflowDesignerPaneProps) {
  const [hasSelectedNode, setHasSelectedNode] = useState(false)
  const { toast } = useToast()
  const {
    schedules,
    isLoading,
    error,
    scheduleEditorOpen,
    scheduleEditorMode,
    editingSchedule,
    openScheduleDrawer,
    setScheduleEditorOpen,
    handleScheduleSaved,
    handleScheduleAction,
    handleScheduleDelete,
    schedulePanelExpanded,
    setSchedulePanelExpanded,
  } = useWorkflowSchedules({
    workflowId,
    toast,
  })

  const { setSchedulesPanelOpen } = useWorkflowUiStore()
  const isMobile = useIsMobile()

  // Webhooks panel state
  const [webhooksPanelExpanded, setWebhooksPanelExpanded] = useState(false)

  // Default webhook URL for direct workflow invocation
  const defaultWebhookUrl = workflowId
    ? `${API_BASE_URL}/workflows/${workflowId}/run`
    : ''

  // Auto-open webhooks sidebar if navigated back with query param
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('openWebhooksSidebar') === 'true') {
      setWebhooksPanelExpanded(true)
      // Clean up the URL by removing the query param
      const newUrl = window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }
  }, [])

  // Sync selection state with UI store for mobile bottom sheet visibility
  useEffect(() => {
    setSchedulesPanelOpen(schedulePanelExpanded)
  }, [schedulePanelExpanded, setSchedulesPanelOpen])

  const workflowOptions = useMemo(() => {
    if (!workflowId) return []
    return [
      {
        id: workflowId,
        name: workflowName,
      },
    ]
  }, [workflowId, workflowName])

  const shouldRenderSummary = Boolean(showSummary && workflowId)

  // Memoize callbacks to prevent infinite re-render loops in Canvas useEffect
  const handleClearNodeSelection = useCallback(() => {
    setHasSelectedNode(false)
  }, [])

  const handleNodeSelectionChange = useCallback((node: ReactFlowNode<FrontendNodeData> | null) => {
    setHasSelectedNode(Boolean(node))
    if (node) {
      setSchedulePanelExpanded(false)
      setWebhooksPanelExpanded(false)
    }
  }, [setSchedulePanelExpanded])

  const summaryNode = shouldRenderSummary ? (
    <WorkflowSchedulesSummaryBar
      schedules={schedules}
      isLoading={isLoading}
      error={error}
      onCreate={() => openScheduleDrawer('create')}
      onExpand={() => setSchedulePanelExpanded(true)}
      onViewAll={onNavigateToSchedules}
    />
  ) : null

  return (
    <WorkflowSchedulesProvider
      value={{
        workflowId,
        schedules,
        isLoading,
        error,
        onScheduleCreate: () => openScheduleDrawer('create'),
        onScheduleEdit: (schedule) => openScheduleDrawer('edit', schedule),
        onScheduleAction: handleScheduleAction,
        onScheduleDelete: handleScheduleDelete,
        onViewSchedules: onNavigateToSchedules,
        onOpenScheduleSidebar: () => setSchedulePanelExpanded(true),
        onCloseScheduleSidebar: () => setSchedulePanelExpanded(false),
        onOpenWebhooksSidebar: () => setWebhooksPanelExpanded(true),
      }}
    >
      <div className="flex-1 h-full flex overflow-hidden">
        <div className="flex-1 h-full relative min-w-0">
          {summaryNode && !hasSelectedNode && !schedulePanelExpanded && !webhooksPanelExpanded && (
            <div className="absolute right-3 top-3 z-20 transition-opacity duration-100 ease-out">
              {summaryNode}
            </div>
          )}
          <Canvas
            className="flex-1 h-full relative"
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            workflowId={workflowId}
            onClearNodeSelection={handleClearNodeSelection}
            onNodeSelectionChange={handleNodeSelectionChange}
            onSnapshot={onCaptureSnapshot}
          />
        </div>

        {/* Schedule Panel - Side panel on desktop, portal on mobile */}
        {schedulePanelExpanded && (
          isMobile ? (
            createPortal(
              <div className="flex h-full w-full overflow-hidden bg-background">
                <WorkflowSchedulesSidebar
                  schedules={schedules}
                  isLoading={isLoading}
                  error={error}
                  onClose={() => setSchedulePanelExpanded(false)}
                  onCreate={() => openScheduleDrawer('create')}
                  onManage={onNavigateToSchedules}
                  onEdit={(schedule) => openScheduleDrawer('edit', schedule)}
                  onAction={handleScheduleAction}
                  onDelete={handleScheduleDelete}
                />
              </div>,
              document.getElementById('mobile-bottom-sheet-portal') || document.body
            )
          ) : (
            <div
              className={cn(
                'transition-all duration-150 ease-out overflow-hidden shrink-0',
                schedulePanelExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{
                width: schedulePanelExpanded ? 432 : 0,
                transition: 'width 150ms ease-out, opacity 150ms ease-out',
              }}
            >
              <WorkflowSchedulesSidebar
                schedules={schedules}
                isLoading={isLoading}
                error={error}
                onClose={() => setSchedulePanelExpanded(false)}
                onCreate={() => openScheduleDrawer('create')}
                onManage={onNavigateToSchedules}
                onEdit={(schedule) => openScheduleDrawer('edit', schedule)}
                onAction={handleScheduleAction}
                onDelete={handleScheduleDelete}
              />
            </div>
          )
        )}

        {/* Webhooks Panel - Side panel on desktop, portal on mobile */}
        {webhooksPanelExpanded && workflowId && (
          isMobile ? (
            createPortal(
              <div className="flex h-full w-full overflow-hidden bg-background">
                <WorkflowWebhooksSidebar
                  workflowId={workflowId}
                  nodes={nodes}
                  defaultWebhookUrl={defaultWebhookUrl}
                  onClose={() => setWebhooksPanelExpanded(false)}
                />
              </div>,
              document.getElementById('mobile-bottom-sheet-portal') || document.body
            )
          ) : (
            <div
              className={cn(
                'transition-all duration-150 ease-out overflow-hidden shrink-0',
                webhooksPanelExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
              style={{
                width: webhooksPanelExpanded ? 432 : 0,
                transition: 'width 150ms ease-out, opacity 150ms ease-out',
              }}
            >
              <WorkflowWebhooksSidebar
                workflowId={workflowId}
                nodes={nodes}
                defaultWebhookUrl={defaultWebhookUrl}
                onClose={() => setWebhooksPanelExpanded(false)}
              />
            </div>
          )
        )}

        {workflowId ? (
          <ScheduleEditorDrawer
            open={scheduleEditorOpen}
            mode={scheduleEditorMode}
            schedule={editingSchedule}
            defaultWorkflowId={workflowId}
            workflowOptions={workflowOptions}
            onClose={() => setScheduleEditorOpen(false)}
            onSaved={handleScheduleSaved}
          />
        ) : null}
      </div>
    </WorkflowSchedulesProvider>
  )
}
