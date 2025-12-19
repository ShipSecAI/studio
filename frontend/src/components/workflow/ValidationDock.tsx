import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
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

const COLLAPSE_THRESHOLD = 3 // Collapse when more than 3 issues

export function ValidationDock({
  nodes,
  edges,
  mode,
  onNodeClick,
}: ValidationDockProps) {
  const { getComponent } = useComponentStore()
  const [isExpanded, setIsExpanded] = useState(false)

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
  const shouldCollapse = totalIssues > COLLAPSE_THRESHOLD

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
          <button
            type="button"
            onClick={() => shouldCollapse && setIsExpanded(!isExpanded)}
            className={cn(
              'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/50',
              shouldCollapse && 'cursor-pointer hover:bg-muted/50 transition-colors'
            )}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
              <span className="text-[11px] font-medium">
                {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            {shouldCollapse && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <span className="text-[10px]">{isExpanded ? 'Collapse' : 'Expand'}</span>
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
              </div>
            )}
          </button>
          <div
            className={cn(
              'divide-y divide-border/50 overflow-hidden transition-all duration-200',
              shouldCollapse && !isExpanded && 'max-h-0',
              (!shouldCollapse || isExpanded) && 'max-h-[300px] overflow-y-auto'
            )}
          >
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

