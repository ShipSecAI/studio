import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitBranch, ArrowLeft } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'

interface RunInfo {
  id: string
  workflowId: string
  workflowName: string
  parentRunId?: string | null
  parentNodeRef?: string | null
}

interface RunBreadcrumbsProps {
  currentRun: RunInfo | null
  className?: string
  /** 'floating' for canvas overlay, 'inline' for panel integration */
  variant?: 'floating' | 'inline'
}

/**
 * Displays breadcrumb navigation for parent/child workflow runs.
 * Shows a link to navigate back to the parent run.
 */
export function RunBreadcrumbs({ currentRun, className, variant = 'inline' }: RunBreadcrumbsProps) {
  const navigate = useNavigate()
  const [parentRun, setParentRun] = useState<RunInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentRun?.parentRunId) {
      setParentRun(null)
      return
    }

    const fetchParentRun = async () => {
      setLoading(true)
      try {
        const run = await api.executions.getRun(currentRun.parentRunId!)
        if (run) {
          setParentRun({
            id: run.id as string,
            workflowId: run.workflowId as string,
            workflowName: (run as any).workflowName || 'Parent Workflow',
            parentRunId: (run as any).parentRunId,
            parentNodeRef: (run as any).parentNodeRef,
          })
        }
      } catch (err) {
        console.error('Failed to fetch parent run:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchParentRun()
  }, [currentRun?.parentRunId])

  // Only show breadcrumbs if this is a child run
  if (!currentRun?.parentRunId) {
    return null
  }

  const handleNavigateToParent = () => {
    if (parentRun) {
      navigate(`/workflows/${parentRun.workflowId}/runs/${parentRun.id}`)
    }
  }

  if (variant === 'floating') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md border bg-background shadow-sm',
          'text-xs font-medium transition-all duration-200',
          className
        )}
      >
        <GitBranch className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-muted-foreground">Child of</span>
        
        {loading ? (
          <span className="text-muted-foreground animate-pulse">loading...</span>
        ) : parentRun ? (
          <button
            onClick={handleNavigateToParent}
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:text-primary/80 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="truncate max-w-[180px]" title={parentRun.workflowName}>
              {parentRun.workflowName}
            </span>
          </button>
        ) : (
          <span className="font-mono text-muted-foreground">
            {currentRun.parentRunId.split('-').slice(0, 3).join('-')}
          </span>
        )}

        {currentRun.parentNodeRef && (
          <code className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            {currentRun.parentNodeRef}
          </code>
        )}
      </div>
    )
  }

  // Inline variant (for panel integration)
  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="text-muted-foreground">Sub-workflow of</span>
      
      {loading ? (
        <span className="text-muted-foreground animate-pulse">loading...</span>
      ) : parentRun ? (
        <button
          onClick={handleNavigateToParent}
          className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 hover:underline"
        >
          <ArrowLeft className="h-3 w-3" />
          <span className="truncate max-w-[200px]" title={parentRun.workflowName}>
            {parentRun.workflowName}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            ({parentRun.id.split('-').slice(0, 3).join('-')})
          </span>
        </button>
      ) : (
        <span className="font-mono text-muted-foreground">
          {currentRun.parentRunId.split('-').slice(0, 3).join('-')}
        </span>
      )}

      {currentRun.parentNodeRef && (
        <>
          <span className="text-muted-foreground mx-1">•</span>
          <span className="text-muted-foreground">
            node <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">{currentRun.parentNodeRef}</code>
          </span>
        </>
      )}
    </div>
  )
}
