import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Workflow, AlertCircle, Trash2, Loader2, Info } from 'lucide-react'
import { api } from '@/services/api'
import {
  WorkflowMetadataSchema,
  type WorkflowMetadataNormalized,
} from '@/schemas/workflow'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { track, Events } from '@/features/analytics/events'
import { useAuth } from '@/auth/auth-context'
import { useRunStore } from '@/store/runStore'

export function WorkflowList() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<WorkflowMetadataNormalized[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const retryCountRef = useRef(0) // Use ref to track actual count
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const isReadOnly = !canManageWorkflows
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowMetadataNormalized | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const token = useAuthStore((state) => state.token)
  const adminUsername = useAuthStore((state) => state.adminUsername)

  const MAX_RETRY_ATTEMPTS = 30 // Try for ~60 seconds (30 attempts × 2s)
  const RETRY_INTERVAL_MS = 2000 // 2 seconds between retries

  useEffect(() => {
    // Wait for auth to be ready before loading workflows
    if (authLoading) {
      return
    }

    // Check if we have authentication (either token or admin credentials)
    const hasAuth = isAuthenticated || token || adminUsername

    if (hasAuth) {
      loadWorkflows()
    } else {
      setIsLoading(false)
      setError('Please log in to view workflows')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading, token, adminUsername])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.workflows.list()
      const normalized = data.map((workflow) => WorkflowMetadataSchema.parse(workflow))
      setWorkflows(normalized)
      setRetryCount(0)
      retryCountRef.current = 0 // Reset on success
      setIsLoading(false)
      // Clear any pending retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      track(Events.WorkflowListViewed, { workflows_count: normalized.length })
    } catch (err) {
      console.error('Failed to load workflows:', err)

      const errorMessage = err instanceof Error ? err.message : 'Failed to load workflows'

      // Check if it's a connection error (backend not ready)
      const isConnectionError =
        errorMessage.includes('ERR_CONNECTION_REFUSED') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('fetch')

      // Use ref for accurate count check to prevent going beyond max attempts
      if (isConnectionError && retryCountRef.current < MAX_RETRY_ATTEMPTS) {
        // Increment both ref and state
        retryCountRef.current += 1
        setRetryCount(retryCountRef.current)

        // Schedule retry - keep loading spinner visible
        retryTimeoutRef.current = setTimeout(() => {
          loadWorkflows()
        }, RETRY_INTERVAL_MS)
      } else {
        // Max retries exhausted or non-connection error
        setError(errorMessage)
        setIsLoading(false)
      }
    }
  }, [MAX_RETRY_ATTEMPTS, RETRY_INTERVAL_MS])

  const handleTryAgain = () => {
    setRetryCount(0)
    retryCountRef.current = 0
    loadWorkflows()
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
      timeZoneName: 'short',
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

        {/* <div className="mb-6 flex flex-wrap gap-3">
          <Button
            onClick={() => navigate('/workflows/new')}
            size="lg"
            className="gap-2"
            disabled={isLoading}
          >
            <Plus className="h-5 w-5" />
            New Workflow
          </Button>
        </div> */}

        {isLoading ? (
          <div className="border rounded-lg bg-card">
            {retryCount > 0 && (
              <div className="px-6 py-4 border-b bg-muted/50 text-center">
                <div className="flex items-center justify-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-base font-semibold text-foreground">
                    Waiting for backend to start... (attempt {retryCount}/{MAX_RETRY_ATTEMPTS})
                  </span>
                </div>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Nodes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 cursor-help">
                            Last Run
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Times shown in your local timezone</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 cursor-help">
                            Last Updated
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Times shown in your local timezone</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  {canManageWorkflows && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Skeleton className="h-4 w-[220px] bg-muted" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-[80px] bg-muted" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-[80px] bg-muted" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[160px] bg-muted" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[160px] bg-muted" />
                    </TableCell>
                    {canManageWorkflows && (
                      <TableCell className="text-right">
                        <Skeleton className="h-8 w-8 ml-auto rounded-md bg-muted" />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : error ? (
          <div className="text-center py-12 border rounded-lg bg-card border-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">Failed to load workflows</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={handleTryAgain} variant="outline">
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
          <div className="border rounded-lg bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Nodes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 cursor-help">
                            Last Run
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Times shown in your local timezone</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 cursor-help">
                            Last Updated
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Times shown in your local timezone</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  {canManageWorkflows && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <WorkflowRowItem
                    key={workflow.id}
                    workflow={workflow}
                    canManageWorkflows={canManageWorkflows}
                    isDeleting={isDeleting}
                    isLoading={isLoading}
                    formatDate={formatDate}
                    onRowClick={() => navigate(`/workflows/${workflow.id}`)}
                    onDeleteClick={handleDeleteClick}
                  />
                ))}
              </TableBody>
            </Table>
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

type WorkflowRowItemProps = {
  workflow: WorkflowMetadataNormalized
  canManageWorkflows: boolean
  isDeleting: boolean
  isLoading: boolean
  formatDate: (dateString: string) => string
  onRowClick: () => void
  onDeleteClick: (event: MouseEvent, workflow: WorkflowMetadataNormalized) => void
}

function WorkflowRowItem({
  workflow,
  canManageWorkflows,
  isDeleting,
  isLoading,
  formatDate,
  onRowClick,
  onDeleteClick,
}: WorkflowRowItemProps) {
  const fetchRuns = useRunStore((state) => state.fetchRuns)
  const latestRun = useRunStore((state) => state.getLatestRun(workflow.id))

  useEffect(() => {
    fetchRuns({ workflowId: workflow.id }).catch(()=>undefined)
  }, [workflow.id, fetchRuns])

  const nodeCount = workflow.nodes.length

  const statusBadge = latestRun ? (
    <Badge
      variant={
        latestRun.status === 'RUNNING' ? 'default' :
        latestRun.status === 'FAILED' ? 'destructive' :
        latestRun.status === 'COMPLETED' ? 'success' :
        'secondary'
      }
      className="text-xs"
    >
      {latestRun.status}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-xs">
      NOT TRIGGERED
    </Badge>
  )

  return (
    <TableRow
      key={workflow.id}
      onClick={onRowClick}
      className="cursor-pointer hover:bg-muted/50"
    >
      <TableCell className="font-medium">{workflow.name}</TableCell>
      <TableCell>
        <Badge variant="secondary">{nodeCount} nodes</Badge>
      </TableCell>
      <TableCell>
        {statusBadge}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {workflow.lastRun ? formatDate(workflow.lastRun) : 'N/A'}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDate(workflow.updatedAt)}
      </TableCell>
      {canManageWorkflows && (
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={(event) => onDeleteClick(event, workflow)}
            disabled={isLoading || isDeleting}
            aria-label={`Delete workflow ${workflow.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

