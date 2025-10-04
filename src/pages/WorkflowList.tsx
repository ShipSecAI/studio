import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Workflow } from 'lucide-react'

interface WorkflowItem {
  id: string
  name: string
  updatedAt: string
  nodeCount: number
}

const mockWorkflows: WorkflowItem[] = [
  {
    id: '1',
    name: 'Subdomain Discovery Pipeline',
    updatedAt: '2025-01-04T10:30:00Z',
    nodeCount: 5,
  },
  {
    id: '2',
    name: 'Port Scan Automation',
    updatedAt: '2025-01-03T15:45:00Z',
    nodeCount: 3,
  },
  {
    id: '3',
    name: 'Vulnerability Assessment',
    updatedAt: '2025-01-02T09:15:00Z',
    nodeCount: 7,
  },
]

export function WorkflowList() {
  const navigate = useNavigate()

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).format(date)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Security Workflow Builder</h1>
          <p className="text-muted-foreground">
            Create and manage security automation workflows
          </p>
        </div>

        <div className="mb-6">
          <Button
            onClick={() => navigate('/workflow/new')}
            size="lg"
            className="gap-2"
          >
            <Plus className="h-5 w-5" />
            New Workflow
          </Button>
        </div>

        {mockWorkflows.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-card">
            <Workflow className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first workflow to get started
            </p>
            <Button onClick={() => navigate('/workflow/new')}>
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mockWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                onClick={() => navigate(`/workflow/${workflow.id}`)}
                className="border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow bg-card"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold">{workflow.name}</h3>
                  <Badge variant="secondary">{workflow.nodeCount} nodes</Badge>
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