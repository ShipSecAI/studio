import { useCallback, useEffect, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'
import { api, API_BASE_URL } from '@/services/api'
import {
  serializeWorkflowForCreate,
  serializeWorkflowForUpdate,
} from '@/utils/workflowSerializer'
import { cloneNodes, cloneEdges, type GraphSnapshot } from './useWorkflowGraphControllers'
import { track, Events } from '@/features/analytics/events'

type WorkflowMetadataShape = {
  id: string | null
  name: string
  description: string
  currentVersionId: string | null
  currentVersion: number | null
}

type SavedMetadata = {
  name: string
  description: string
}

type ToastFn = (params: {
  title: string
  description?: string
  variant?: 'default' | 'destructive' | 'warning' | 'success'
}) => void

interface UseDesignWorkflowPersistenceOptions {
  canManageWorkflows: boolean
  isDirty: boolean
  isNewWorkflow: boolean
  metadata: WorkflowMetadataShape
  designNodes: ReactFlowNode<FrontendNodeData>[]
  designEdges: ReactFlowEdge[]
  designNodesRef: MutableRefObject<ReactFlowNode<FrontendNodeData>[]>
  designEdgesRef: MutableRefObject<ReactFlowEdge[]>
  designSavedSnapshotRef: MutableRefObject<GraphSnapshot | null>
  markDirty: () => void
  markClean: () => void
  setWorkflowId: (id: string) => void
  setMetadata: (metadata: Partial<WorkflowMetadataShape>) => void
  navigate: (path: string, options?: { replace?: boolean }) => void
  toast: ToastFn
  computeGraphSignature: (
    nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
    edgesSnapshot: ReactFlowEdge[] | null,
  ) => string
  workflowRoutePrefix?: string
}

interface UseDesignWorkflowPersistenceResult {
  handleSave: (showToast?: boolean) => Promise<void>
  lastSavedGraphSignature: string | null
  setLastSavedGraphSignature: (value: string | null) => void
  lastSavedMetadata: SavedMetadata | null
  setLastSavedMetadata: (value: SavedMetadata | null) => void
  hasGraphChanges: boolean
  hasMetadataChanges: boolean
}

export function useDesignWorkflowPersistence({
  canManageWorkflows,
  isDirty,
  isNewWorkflow,
  metadata,
  designNodes,
  designEdges,
  designNodesRef,
  designEdgesRef,
  designSavedSnapshotRef,
  markDirty,
  markClean,
  setWorkflowId,
  setMetadata,
  navigate,
  toast,
  computeGraphSignature,
  workflowRoutePrefix = '/workflows',
}: UseDesignWorkflowPersistenceOptions): UseDesignWorkflowPersistenceResult {
  const [lastSavedGraphSignature, setLastSavedGraphSignature] = useState<string | null>(null)
  const [lastSavedMetadata, setLastSavedMetadata] = useState<SavedMetadata | null>(null)
  const [hasGraphChanges, setHasGraphChanges] = useState(false)
  const [hasMetadataChanges, setHasMetadataChanges] = useState(false)

  useEffect(() => {
    const currentSignature = computeGraphSignature(designNodes, designEdges)

    if (lastSavedGraphSignature === null) {
      setLastSavedGraphSignature(currentSignature)
      setHasGraphChanges(false)
      return
    }

    setHasGraphChanges(currentSignature !== lastSavedGraphSignature)
  }, [designNodes, designEdges, computeGraphSignature, lastSavedGraphSignature])

  useEffect(() => {
    const normalizedMetadata: SavedMetadata = {
      name: metadata.name,
      description: metadata.description ?? '',
    }

    if (lastSavedMetadata === null) {
      setLastSavedMetadata(normalizedMetadata)
      setHasMetadataChanges(false)
      return
    }

    const changed =
      normalizedMetadata.name !== lastSavedMetadata.name ||
      normalizedMetadata.description !== lastSavedMetadata.description
    setHasMetadataChanges(changed)
  }, [metadata.name, metadata.description, lastSavedMetadata])

  useEffect(() => {
    const shouldBeDirty = hasGraphChanges || hasMetadataChanges
    if (shouldBeDirty && !isDirty) {
      markDirty()
    } else if (!shouldBeDirty && isDirty) {
      markClean()
    }
  }, [hasGraphChanges, hasMetadataChanges, isDirty, markDirty, markClean])

  const handleSave = useCallback(
    async (showToast: boolean = true) => {
      if (!canManageWorkflows) {
        if (showToast) {
          toast({
            variant: 'destructive',
            title: 'Insufficient permissions',
            description: 'Only administrators can save workflow changes.',
          })
        }
        return
      }

      if (!isDirty) {
        if (showToast) {
          toast({
            title: 'No changes to save',
            description: 'Your workflow matches the last saved version.',
          })
        }
        return
      }

      try {
        if (!designNodes || !Array.isArray(designNodes)) {
          if (showToast) {
            toast({
              variant: 'destructive',
              title: 'Cannot save workflow',
              description: 'Invalid workflow nodes data.',
            })
          }
          return
        }

        if (!designEdges || !Array.isArray(designEdges)) {
          if (showToast) {
            toast({
              variant: 'destructive',
              title: 'Cannot save workflow',
              description: 'Invalid workflow edges data.',
            })
          }
          return
        }

        const workflowId = metadata.id
        const metadataChangesOnly = hasMetadataChanges && !hasGraphChanges

        if (metadataChangesOnly && workflowId && !isNewWorkflow) {
          const updatedMetadata = await api.workflows.updateMetadata(workflowId, {
            name: metadata.name,
            description: metadata.description ?? '',
          })

          setMetadata({
            id: updatedMetadata.id,
            name: updatedMetadata.name,
            description: updatedMetadata.description ?? '',
            currentVersionId: updatedMetadata.currentVersionId ?? null,
            currentVersion: updatedMetadata.currentVersion ?? null,
          })

          setLastSavedMetadata({
            name: updatedMetadata.name,
            description: updatedMetadata.description ?? '',
          })
          setHasMetadataChanges(false)
          markClean()

          if (showToast) {
            toast({
              variant: 'success',
              title: 'Workflow details updated',
              description: 'Name and description have been synced.',
            })
          }
          return
        }

        if (!workflowId || isNewWorkflow) {
          if (designNodes.length === 0) {
            if (showToast) {
              toast({
                variant: 'destructive',
                title: 'Cannot save workflow',
                description: 'Add at least one component before saving.',
              })
            }
            return
          }

          const payload = serializeWorkflowForCreate(
            metadata.name,
            metadata.description || undefined,
            designNodes,
            designEdges,
          )

          const savedWorkflow = await api.workflows.create(payload)

          setWorkflowId(savedWorkflow.id)
          setMetadata({
            id: savedWorkflow.id,
            name: savedWorkflow.name,
            description: savedWorkflow.description ?? '',
            currentVersionId: savedWorkflow.currentVersionId ?? null,
            currentVersion: savedWorkflow.currentVersion ?? null,
          })
          markClean()
          const newSignature = computeGraphSignature(designNodesRef.current, designEdgesRef.current)
          setLastSavedGraphSignature(newSignature)
          setLastSavedMetadata({
            name: savedWorkflow.name,
            description: savedWorkflow.description ?? '',
          })
          setHasGraphChanges(false)
          setHasMetadataChanges(false)

          designSavedSnapshotRef.current = {
            nodes: cloneNodes(designNodesRef.current),
            edges: cloneEdges(designEdgesRef.current),
          }

          navigate(`${workflowRoutePrefix}/${savedWorkflow.id}`, { replace: true })

          track(Events.WorkflowCreated, {
            workflow_id: savedWorkflow.id,
            node_count: designNodes.length,
            edge_count: designEdges.length,
          })

          if (showToast) {
            toast({
              variant: 'success',
              title: 'Workflow created',
              description: 'Your workflow has been saved and is ready to run.',
            })
          }
        } else {
          const payload = serializeWorkflowForUpdate(
            workflowId,
            metadata.name,
            metadata.description || undefined,
            designNodes,
            designEdges,
          )

          const updatedWorkflow = await api.workflows.update(workflowId, payload)
          setMetadata({
            id: updatedWorkflow.id,
            name: updatedWorkflow.name,
            description: updatedWorkflow.description ?? '',
            currentVersionId: updatedWorkflow.currentVersionId ?? null,
            currentVersion: updatedWorkflow.currentVersion ?? null,
          })
          markClean()
          const newSignature = computeGraphSignature(designNodesRef.current, designEdgesRef.current)
          setLastSavedGraphSignature(newSignature)
          setLastSavedMetadata({
            name: updatedWorkflow.name,
            description: updatedWorkflow.description ?? '',
          })
          setHasGraphChanges(false)
          setHasMetadataChanges(false)

          designSavedSnapshotRef.current = {
            nodes: cloneNodes(designNodesRef.current),
            edges: cloneEdges(designEdgesRef.current),
          }

          track(Events.WorkflowSaved, {
            workflow_id: updatedWorkflow.id,
            node_count: designNodes.length,
            edge_count: designEdges.length,
          })

          if (showToast) {
            toast({
              variant: 'success',
              title: 'Workflow saved',
              description: 'All changes have been saved.',
            })
          }
        }
      } catch (error) {
        console.error('Failed to save workflow:', error)

        const isNetworkError =
          error instanceof Error &&
          (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

        if (isNetworkError) {
          if (showToast) {
            toast({
              variant: 'destructive',
              title: 'Cannot connect to backend',
              description: `Ensure the backend is running at ${API_BASE_URL}. Your workflow remains available locally.`,
            })
          }
        } else {
          if (showToast) {
            toast({
              variant: 'destructive',
              title: 'Failed to save workflow',
              description: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        }
      }
    },
    [
      canManageWorkflows,
      computeGraphSignature,
      designEdges,
      designNodes,
      designNodesRef,
      designEdgesRef,
      designSavedSnapshotRef,
      isDirty,
      isNewWorkflow,
      markClean,
      markDirty,
      metadata.description,
      metadata.id,
      metadata.name,
      navigate,
      setMetadata,
      setWorkflowId,
      toast,
      hasGraphChanges,
      hasMetadataChanges,
      workflowRoutePrefix,
    ],
  )

  return {
    handleSave,
    lastSavedGraphSignature,
    setLastSavedGraphSignature,
    lastSavedMetadata,
    setLastSavedMetadata,
    hasGraphChanges,
    hasMetadataChanges,
  }
}
