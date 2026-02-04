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
    <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-[#1a1a1a] border-l border-white/10 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <Workflow className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">Workflow Preview</h3>
            <p className="text-xs text-[#666]">Quick actions & details</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-[#666] hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
            <p className="text-sm text-[#666]">Loading workflow...</p>
          </div>
        ) : workflow ? (
          <>
            {/* Workflow Name */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">{workflow.name}</h2>
              {workflow.description && (
                <p className="text-sm text-[#888] leading-relaxed">{workflow.description}</p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleRunWorkflow}
                disabled={isRunning}
                className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white shadow-lg shadow-green-500/20"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {isRunning ? 'Running...' : 'Run Now'}
              </Button>
              <Button
                onClick={handleOpenWorkflow}
                variant="outline"
                className="flex-1 border-white/10 hover:bg-white/5"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </div>

            {/* Workflow Info */}
            <div className="space-y-3 pt-4 border-t border-white/10">
              <h4 className="text-xs font-medium text-[#666] uppercase tracking-wider">Details</h4>

              <div className="space-y-2">
                {workflow.version && (
                  <div className="flex items-center gap-3 text-sm">
                    <FileCode className="h-4 w-4 text-[#555]" />
                    <span className="text-[#888]">Version</span>
                    <Badge variant="secondary" className="ml-auto bg-white/5 text-white/70">
                      v{workflow.version}
                    </Badge>
                  </div>
                )}

                {workflow.createdAt && (
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-[#555]" />
                    <span className="text-[#888]">Created</span>
                    <span className="ml-auto text-white/70">
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
                    <Clock className="h-4 w-4 text-[#555]" />
                    <span className="text-[#888]">Updated</span>
                    <span className="ml-auto text-white/70">
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
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-primary hover:text-primary/80 hover:bg-primary/5 rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Editor
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-[#555] mb-3" />
            <p className="text-sm text-[#666]">Workflow not found</p>
          </div>
        )}
      </div>
    </div>
  );
}
