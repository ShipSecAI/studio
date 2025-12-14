import { useMemo } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useComponentStore } from '@/store/componentStore'
import { getNodeValidationWarnings } from '@/utils/connectionValidation'
import type { Node, Edge } from 'reactflow'
import type { NodeData, FrontendNodeData } from '@/schemas/node'

interface ValidationIssue {
  nodeId: string
  nodeLabel: string
  message: string
}

interface ValidationDockProps {
  nodes: Node<NodeData>[]
  edges: Edge[]
  mode: string
  onNodeClick: (nodeId: string) => void
}

export function ValidationDock({
  nodes,
  edges,
  mode,
  onNodeClick,
}: ValidationDockProps) {
  const { getComponent } = useComponentStore()

  // Only show validation in design mode
  const isDesignMode = mode === 'design'

  const validationIssues = useMemo<ValidationIssue[]>(() => {
    if (!isDesignMode) return []

    const issues: ValidationIssue[] = []

    nodes.forEach((node) => {
      const nodeData = node.data as any
      const componentRef = nodeData.componentId ?? nodeData.componentSlug
      const component = getComponent(componentRef)

      if (!component) return

      // Get validation warnings using the existing utility
      // FrontendNodeData extends NodeData, so this cast is safe
      const warnings = getNodeValidationWarnings(node as Node<FrontendNodeData>, edges, component)

      warnings.forEach((warning) => {
        issues.push({
          nodeId: node.id,
          nodeLabel: nodeData.label || component.name || node.id,
          message: warning,
        })
      })
    })

    return issues
  }, [nodes, edges, getComponent, isDesignMode])

  const totalIssues = validationIssues.length
  const hasIssues = totalIssues > 0

  // Don't show dock if not in design mode
  if (!isDesignMode) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute bottom-3 z-50',
        'bg-background/95 backdrop-blur-sm border rounded-md shadow-md',
        'max-w-lg w-auto',
        'transition-all duration-200',
        hasIssues ? 'border-red-500/50' : 'border-green-500/50'
      )}
      style={{
        left: '40%', // 50% - 10% = 40%
        transform: 'translateX(-50%)',
      }}
    >
      {hasIssues ? (
        <>
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50">
            <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
            <span className="text-[11px] font-medium">
              {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}
            </span>
          </div>
          <div className="divide-y divide-border/50">
            {validationIssues.map((issue, index) => (
              <button
                key={`${issue.nodeId}-${index}`}
                type="button"
                onClick={() => onNodeClick(issue.nodeId)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]',
                  'hover:bg-red-50/50 dark:hover:bg-red-950/30',
                  'transition-colors cursor-pointer',
                  'group'
                )}
              >
                <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
                <span className="font-medium text-foreground group-hover:text-red-600 dark:group-hover:text-red-400 truncate">
                  {issue.nodeLabel}
                </span>
                <span className="text-muted-foreground truncate">· {issue.message}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          <span className="text-[11px] text-muted-foreground">
            All validated
          </span>
        </div>
      )}
    </div>
  )
}

