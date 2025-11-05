import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Workflow, Loader2, AlertCircle, Plug, Trash2 } from 'lucide-react'
import { api } from '@/services/api'
import {
  WorkflowMetadataSchema,
  type WorkflowMetadataNormalized,
} from '@/schemas/workflow'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { track, Events } from '@/features/analytics/events'

export function WorkflowList() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<WorkflowMetadataNormalized[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const isReadOnly = !canManageWorkflows
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowMetadataNormalized | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.workflows.list()
      const normalized = data.map((workflow) => WorkflowMetadataSchema.parse(workflow))
      setWorkflows(normalized)
      track(Events.WorkflowListViewed, { workflows_count: normalized.length })
    } catch (err) {
      console.error('Failed to load workflows:', err)
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteClick = (event: MouseEvent, workflow: WorkflowMetadataNormalized) => {
    event.stopPropagation()
    if (!canManageWorkflows) {
      return
    }
    setWorkflowToDelete(workflow)
    setDeleteError(null)
    setIsDeleteDialogOpen(true)
  }

  const handleDeleteDialogChange = (open: boolean) => {
    setIsDeleteDialogOpen(open)
    if (!open) {
      setWorkflowToDelete(null)
      setDeleteError(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!workflowToDelete || !canManageWorkflows) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await api.workflows.delete(workflowToDelete.id)
      setWorkflows((prev) => prev.filter((workflow) => workflow.id !== workflowToDelete.id))
      handleDeleteDialogChange(false)
    } catch (err) {
      console.error('Failed to delete workflow:', err)
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete workflow')
    } finally {
      setIsDeleting(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).format(date)
  }

  const handleCreateWorkflow = () => {
    if (!canManageWorkflows) {
      return
    }
    track(Events.WorkflowCreateClicked, {})
    navigate('/workflows/new')
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4">
        {isReadOnly && (
          <div className="mb-6 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            You are viewing workflows with read-only access. Administrators can create and edit workflows.
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Your Workflows</h2>
          <p className="text-muted-foreground">
            Create and manage security automation workflows with powerful visual tools
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <Button
            onClick={() => navigate('/workflows/new')}
            size="lg"
            className="gap-2"
            disabled={isLoading}
          >
            <Plus className="h-5 w-5" />
            New Workflow
          </Button>
          <Button
            onClick={() => navigate('/secrets')}
            size="lg"
            variant="outline"
            disabled={isLoading}
          >
            Manage Secrets
          </Button>
          <Button
            onClick={() => navigate('/integrations')}
            size="lg"
            variant="outline"
            disabled={isLoading}
            className="gap-2"
          >
            <Plug className="h-5 w-5" />
            Manage Connections
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Loading workflows...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12 border rounded-lg bg-card border-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">Failed to load workflows</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadWorkflows} variant="outline">
              Try Again
            </Button>
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-card">
            <Workflow className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first workflow to get started
            </p>
            <Button onClick={handleCreateWorkflow} disabled={isReadOnly}>
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((workflow) => {
              const nodeCount = workflow.nodes.length
              return (
                <div
                  key={workflow.id}
                  onClick={() => navigate(`/workflows/${workflow.id}`)}
                  className="border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow bg-card"
                >
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="flex flex-col">
                      <h3 className="text-lg font-semibold">{workflow.name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{nodeCount} nodes</Badge>
                      {canManageWorkflows && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(event) => handleDeleteClick(event, workflow)}
                          disabled={isLoading || isDeleting}
                          aria-label={`Delete workflow ${workflow.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Updated {formatDate(workflow.updatedAt)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {canManageWorkflows && (
        <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete workflow</DialogTitle>
              <DialogDescription>
                This action permanently removes the workflow and its configuration. Runs and logs remain available for auditing purposes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm">
                <span className="font-medium">Workflow:</span>{' '}
                <span>{workflowToDelete?.name}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                ID: <span className="font-mono">{workflowToDelete?.id}</span>
              </div>
              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDeleteDialogChange(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete workflow'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
