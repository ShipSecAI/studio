import { useMemo, useState } from 'react'
import type { SetStateAction } from 'react'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import { Canvas } from '@/components/workflow/Canvas'
import { WorkflowSchedulesSummaryBar, WorkflowSchedulesSidebar } from '@/components/workflow/WorkflowSchedulesPanel'
import type { FrontendNodeData } from '@/schemas/node'
import { WorkflowSchedulesProvider } from '@/features/workflow-builder/contexts/WorkflowSchedulesContext'
import { useWorkflowSchedules } from '@/features/workflow-builder/hooks/useWorkflowSchedules'
import { ScheduleEditorDrawer } from '@/components/schedules/ScheduleEditorDrawer'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

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
      }}
    >
      <div className="flex-1 h-full relative">
        {summaryNode && !hasSelectedNode && !schedulePanelExpanded && (
          <div className="absolute right-2 top-2 z-40 flex justify-end w-full transition-opacity duration-100 ease-out">
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
          onClearNodeSelection={() => {
            setHasSelectedNode(false)
          }}
          onNodeSelectionChange={(node) => {
            setHasSelectedNode(Boolean(node))
            if (node) {
              setSchedulePanelExpanded(false)
            }
          }}
        />

        {schedulePanelExpanded && (
          <div className={cn('absolute top-0 right-0 h-full z-30 w-80 bg-background border-l border-border shadow-xl')}>
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
