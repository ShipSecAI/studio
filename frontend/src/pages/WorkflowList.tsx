import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Workflow, AlertCircle, Trash2, Info, GripVertical } from 'lucide-react';
import { api, type WorkflowSummary } from '@/services/api';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { useAuthStore } from '@/store/authStore';
import { hasAdminRole } from '@/utils/auth';
import { track, Events } from '@/features/analytics/events';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const WORKFLOW_ORDER_KEY = 'workflow-list-order';

function getSavedOrder(): string[] {
  try {
    const saved = localStorage.getItem(WORKFLOW_ORDER_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveOrder(ids: string[]) {
  localStorage.setItem(WORKFLOW_ORDER_KEY, JSON.stringify(ids));
}

function applyOrder<T extends { id: string }>(items: T[], savedOrder: string[]): T[] {
  if (savedOrder.length === 0) return items;
  const orderMap = new Map(savedOrder.map((id, idx) => [id, idx]));
  return [...items].sort((a, b) => {
    const aIdx = orderMap.get(a.id) ?? Infinity;
    const bIdx = orderMap.get(b.id) ?? Infinity;
    return aIdx - bIdx;
  });
}

export function WorkflowList() {
  const navigate = useNavigate();
  const { data: rawWorkflows = [], isLoading, error, refetch } = useWorkflowsSummary();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const trackedRef = useRef(false);

  const roles = useAuthStore((state) => state.roles);
  const canManageWorkflows = hasAdminRole(roles);
  const isReadOnly = !canManageWorkflows;
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync ordered workflows from query data
  useEffect(() => {
    if (rawWorkflows.length > 0) {
      setWorkflows(applyOrder(rawWorkflows, getSavedOrder()));
      if (!trackedRef.current) {
        track(Events.WorkflowListViewed, { workflows_count: rawWorkflows.length });
        trackedRef.current = true;
      }
    } else if (!isLoading) {
      setWorkflows([]);
    }
  }, [rawWorkflows, isLoading]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkflows((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === active.id);
      const newIndex = prev.findIndex((w) => w.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(prev, oldIndex, newIndex);
        saveOrder(reordered.map((w) => w.id));
        return reordered;
      }
      return prev;
    });
  }, []);

  const handleDeleteClick = (event: MouseEvent, workflow: WorkflowSummary) => {
    event.stopPropagation();
    if (!canManageWorkflows) {
      return;
    }
    setWorkflowToDelete(workflow);
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteDialogChange = (open: boolean) => {
    setIsDeleteDialogOpen(open);
    if (!open) {
      setWorkflowToDelete(null);
      setDeleteError(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!workflowToDelete || !canManageWorkflows) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await api.workflows.delete(workflowToDelete.id);
      setWorkflows((prev) => prev.filter((workflow) => workflow.id !== workflowToDelete.id));
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.summary() });
      handleDeleteDialogChange(false);
    } catch (err) {
      console.error('Failed to delete workflow:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete workflow');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(date);
  };

  const handleCreateWorkflow = () => {
    if (!canManageWorkflows) {
      return;
    }
    track(Events.WorkflowCreateClicked, {});
    navigate('/workflows/new');
  };

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        {isReadOnly && (
          <div className="mb-4 md:mb-6 rounded-md border border-border/60 bg-muted/30 px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm text-muted-foreground">
            You are viewing workflows with read-only access. Administrators can create and edit
            workflows.
          </div>
        )}

        <div className="mb-4 md:mb-8">
          <h2 className="text-xl md:text-2xl font-bold mb-1 md:mb-2">Your Workflows</h2>
          <p className="text-sm md:text-base text-muted-foreground">
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
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
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
                      <TableCell className="w-10 px-2">
                        <Skeleton className="h-4 w-4 bg-muted" />
                      </TableCell>
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
          </div>
        ) : error ? (
          <div className="text-center py-12 border rounded-lg bg-card border-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">Failed to load workflows</h3>
            <p className="text-muted-foreground mb-4">{error?.message ?? 'Unknown error'}</p>
            <Button onClick={() => refetch()} variant="outline">
              Try Again
            </Button>
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-8 md:py-12 border rounded-lg bg-card">
            <Workflow className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-3 md:mb-4 text-muted-foreground" />
            <h3 className="text-base md:text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-sm md:text-base text-muted-foreground mb-4 px-4">
              Create your first workflow to get started
            </p>
            <Button onClick={handleCreateWorkflow} disabled={isReadOnly} size="default">
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="border rounded-lg bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="min-w-[150px]">Name</TableHead>
                      <TableHead className="min-w-[80px]">Nodes</TableHead>
                      <TableHead className="min-w-[100px]">Status</TableHead>
                      <TableHead className="min-w-[140px] hidden sm:table-cell">
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
                      <TableHead className="min-w-[140px] hidden md:table-cell">
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
                      {canManageWorkflows && (
                        <TableHead className="text-right min-w-[60px]">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <SortableContext
                      items={workflows.map((w) => w.id)}
                      strategy={verticalListSortingStrategy}
                    >
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
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          </div>
        )}
      </div>

      {canManageWorkflows && (
        <Dialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete workflow</DialogTitle>
              <DialogDescription>
                This action permanently removes the workflow and its configuration. Runs and logs
                remain available for auditing purposes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm">
                <span className="font-medium">Workflow:</span> <span>{workflowToDelete?.name}</span>
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
              <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting…' : 'Delete workflow'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface WorkflowRowItemProps {
  workflow: WorkflowSummary;
  canManageWorkflows: boolean;
  isDeleting: boolean;
  isLoading: boolean;
  formatDate: (dateString: string) => string;
  onRowClick: () => void;
  onDeleteClick: (event: MouseEvent, workflow: WorkflowSummary) => void;
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workflow.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const nodeCount = workflow.nodeCount;

  const statusBadge = workflow.latestRunStatus ? (
    <Badge
      variant="outline"
      className={getStatusBadgeClassFromStatus(workflow.latestRunStatus, 'text-xs')}
    >
      {workflow.latestRunStatus}
    </Badge>
  ) : (
    <Badge variant="outline" className={getStatusBadgeClassFromStatus('NONE', 'text-xs')}>
      NOT TRIGGERED
    </Badge>
  );

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      onClick={onRowClick}
      className={`cursor-pointer transition-colors duration-150 hover:bg-accent/50 dark:hover:bg-accent/30 ${isDragging ? 'bg-accent/50 shadow-lg' : ''}`}
    >
      <TableCell className="w-10 px-2">
        <div
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </TableCell>
      <TableCell className="font-medium">
        <div className="max-w-[200px] truncate" title={workflow.name}>
          {workflow.name}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">
          {nodeCount}
        </Badge>
      </TableCell>
      <TableCell>{statusBadge}</TableCell>
      <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">
        {workflow.lastRun ? formatDate(workflow.lastRun) : 'N/A'}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm hidden md:table-cell">
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
  );
}
