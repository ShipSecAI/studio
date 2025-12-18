import { useCallback } from 'react'
import {
  deserializeNodes,
  deserializeEdges,
  serializeNodes,
  serializeEdges,
} from '@/utils/workflowSerializer'
import { WorkflowImportSchema, DEFAULT_WORKFLOW_VIEWPORT } from '@/schemas/workflow'
import { cloneNodes, cloneEdges } from '@/features/workflow-builder/hooks/useWorkflowGraphControllers'
import type { FrontendNodeData } from '@/schemas/node'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
type WorkflowMetadataShape = {
  id: string | null
  name: string
  description: string
  currentVersionId: string | null
  currentVersion: number | null
}

interface UseWorkflowImportExportOptions {
  canManageWorkflows: boolean
  toast: (params: { title: string; description?: string; variant?: 'default' | 'destructive' | 'warning' | 'success' }) => void
  metadata: WorkflowMetadataShape
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
  setDesignNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void
  setDesignEdges: (edges: ReactFlowEdge[]) => void
  setExecutionNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void
  setExecutionEdges: (edges: ReactFlowEdge[]) => void
  setMetadata: (metadata: Partial<WorkflowMetadataShape>) => void
  markDirty: () => void
  resetWorkflow: () => void
  setMode: (mode: 'design' | 'execution') => void
}

interface UseWorkflowImportExportResult {
  handleImportWorkflow: (file: File) => Promise<void>
  handleExportWorkflow: () => void
}

export function useWorkflowImportExport({
  canManageWorkflows,
  toast,
  metadata,
  nodes,
  edges,
  setDesignNodes,
  setDesignEdges,
  setExecutionNodes,
  setExecutionEdges,
  setMetadata,
  markDirty,
  resetWorkflow,
  setMode,
}: UseWorkflowImportExportOptions): UseWorkflowImportExportResult {
  const handleImportWorkflow = useCallback(
    async (file: File) => {
      if (!canManageWorkflows) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can import workflows.',
        })
        return
      }

      const contents = await file.text()
      const parsed = WorkflowImportSchema.parse(JSON.parse(contents))

      const graph = 'graph' in parsed
        ? {
          nodes: parsed.graph.nodes ?? [],
          edges: parsed.graph.edges ?? [],
          viewport: parsed.graph.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
        }
        : {
          nodes: parsed.nodes ?? [],
          edges: parsed.edges ?? [],
          viewport: parsed.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
        }

      const workflowGraph = {
        graph: {
          nodes: graph.nodes,
          edges: graph.edges,
          viewport: graph.viewport,
        },
      }

      const normalizedNodes = deserializeNodes(workflowGraph)
      const normalizedEdges = deserializeEdges(workflowGraph)

      resetWorkflow()
      setDesignNodes(normalizedNodes)
      setDesignEdges(normalizedEdges)
      setExecutionNodes(cloneNodes(normalizedNodes))
      setExecutionEdges(cloneEdges(normalizedEdges))
      setMetadata({
        id: null,
        name: parsed.name,
        description: parsed.description ?? '',
        currentVersion: null,
        currentVersionId: null,
      })
      markDirty()
      setMode('design')

      toast({
        variant: 'success',
        title: 'Workflow imported',
        description: `Loaded ${parsed.name}`,
      })
    },
    [
      canManageWorkflows,
      markDirty,
      resetWorkflow,
      setDesignEdges,
      setDesignNodes,
      setExecutionEdges,
      setExecutionNodes,
      setMetadata,
      setMode,
      toast,
    ],
  )

  const handleExportWorkflow = useCallback(() => {
    if (!canManageWorkflows) {
      toast({
        variant: 'destructive',
        title: 'Insufficient permissions',
        description: 'Only administrators can export workflows.',
      })
      return
    }

    if (nodes.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot export workflow',
        description: 'Add at least one component before exporting.',
      })
      return
    }

    try {
      if (typeof window === 'undefined') {
        throw new Error('Export is only available in a browser environment.')
      }

      const exportedNodes = serializeNodes(nodes)
      const exportedEdges = serializeEdges(edges)

      const payload = {
        name: metadata.name || 'Untitled Workflow',
        description: metadata.description || '',
        graph: {
          nodes: exportedNodes,
          edges: exportedEdges,
          viewport: DEFAULT_WORKFLOW_VIEWPORT,
        },
        metadata: {
          workflowId: metadata.id ?? null,
          currentVersionId: metadata.currentVersionId ?? null,
          currentVersion: metadata.currentVersion ?? null,
          exportedAt: new Date().toISOString(),
        },
      }

      const fileContents = JSON.stringify(payload, null, 2)
      const blob = new Blob([fileContents], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const safeName = (metadata.name || 'workflow')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'workflow'

      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        variant: 'success',
        title: 'Workflow exported',
        description: `${safeName}.json saved to your device.`,
      })
    } catch (error) {
      console.error('Failed to export workflow:', error)
      toast({
        variant: 'destructive',
        title: 'Failed to export workflow',
        description: error instanceof Error ? error.message : 'Unknown error occurred.',
      })
    }
  }, [canManageWorkflows, edges, metadata, nodes, toast])

  return {
    handleImportWorkflow,
    handleExportWorkflow,
  }
}
