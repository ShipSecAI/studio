import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Workflow, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/services/api'
import type { WorkflowMetadata } from '@/schemas/workflow'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { track, Events } from '@/features/analytics/events'

export function WorkflowList() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<WorkflowMetadata[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const isReadOnly = !canManageWorkflows

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.workflows.list()
      setWorkflows(data)
      track(Events.WorkflowListViewed, { workflows_count: Array.isArray(data) ? data.length : undefined })
    } catch (err) {
      console.error('Failed to load workflows:', err)
      setError(err instanceof Error ? err.message : 'Failed to load workflows')
    } finally {
      setIsLoading(false)
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
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                onClick={() => navigate(`/workflows/${workflow.id}`)}
                className="border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow bg-card"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold">{workflow.name}</h3>
                  <Badge variant="secondary">
                    {workflow.graph.nodes?.length || 0} nodes
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Updated {formatDate(workflow.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
