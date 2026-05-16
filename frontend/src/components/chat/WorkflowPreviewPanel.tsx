import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Play,
  Edit,
  ExternalLink,
  Clock,
  AlertCircle,
  Workflow,
  Loader2,
  Calendar,
  FileCode,
} from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WorkflowDetails {
  id: string;
  name: string;
  description?: string;
  status?: string;
  lastRun?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  nodeCount?: number;
  version?: number;
}

export function WorkflowPreviewPanel() {
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<WorkflowDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const { isWorkflowPreviewOpen, selectedWorkflowId, setWorkflowPreviewOpen, setSelectedWorkflow } =
    useChatStore();

  useEffect(() => {
    if (selectedWorkflowId && isWorkflowPreviewOpen) {
      loadWorkflow(selectedWorkflowId);
    }
  }, [selectedWorkflowId, isWorkflowPreviewOpen]);

  const loadWorkflow = async (id: string) => {
    setIsLoading(true);
    try {
      const data = await api.workflows.get(id);
      setWorkflow({
        id: data.id,
        name: data.name,
        description: data.description ?? undefined,
        createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
        version: data.currentVersion ?? undefined,
      });
    } catch (error) {
      console.error('Failed to load workflow', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunWorkflow = async () => {
    if (!workflow) return;
    setIsRunning(true);
    try {
      await api.workflows.run(workflow.id);
      // Could add a toast notification here
    } catch (error) {
      console.error('Failed to run workflow', error);
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    setWorkflowPreviewOpen(false);
    setSelectedWorkflow(null);
  };

  const handleOpenWorkflow = () => {
    if (workflow) {
      navigate(`/workflows/${workflow.id}`);
      handleClose();
    }
  };

  if (!isWorkflowPreviewOpen || !selectedWorkflowId) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 z-50 flex w-[380px] flex-col border-l bg-background shadow-lg animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border bg-muted p-2">
            <Workflow className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">Workflow Preview</h3>
            <p className="text-xs text-muted-foreground">Quick actions & details</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading workflow...</p>
          </div>
        ) : workflow ? (
          <>
            {/* Workflow Name */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">{workflow.name}</h2>
              {workflow.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {workflow.description}
                </p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleRunWorkflow} disabled={isRunning} className="flex-1">
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {isRunning ? 'Running...' : 'Run Now'}
              </Button>
              <Button onClick={handleOpenWorkflow} variant="outline" className="flex-1">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>

            {/* Workflow Info */}
            <div className="space-y-3 border-t pt-4">
              <h4 className="text-xs font-medium text-muted-foreground">Details</h4>

              <div className="space-y-2">
                {workflow.version && (
                  <div className="flex items-center gap-3 text-sm">
                    <FileCode className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Version</span>
                    <Badge variant="secondary" className="ml-auto">
                      v{workflow.version}
                    </Badge>
                  </div>
                )}

                {workflow.createdAt && (
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Created</span>
                    <span className="ml-auto text-foreground">
                      {workflow.createdAt.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}

                {workflow.updatedAt && (
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Updated</span>
                    <span className="ml-auto text-foreground">
                      {workflow.updatedAt.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Open Full View */}
            <button
              onClick={handleOpenWorkflow}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm text-primary transition-colors hover:bg-muted hover:text-primary/80"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Editor
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Workflow not found</p>
          </div>
        )}
      </div>
    </div>
  );
}
