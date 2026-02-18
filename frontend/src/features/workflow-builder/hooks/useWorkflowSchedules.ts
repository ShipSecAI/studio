import { useCallback, useState } from 'react';
import type { WorkflowSchedule } from '@shipsec/shared';
import { api } from '@/services/api';
import { useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useQueryClient } from '@tanstack/react-query';

type ToastVariant = 'default' | 'destructive' | 'warning' | 'success';

interface ToastParams {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface UseWorkflowSchedulesOptions {
  workflowId?: string | null;
  toast: (params: ToastParams) => void;
}

interface UseWorkflowSchedulesResult {
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error: string | null;
  refreshSchedules: () => Promise<void>;
  scheduleEditorOpen: boolean;
  scheduleEditorMode: 'create' | 'edit';
  editingSchedule: WorkflowSchedule | null;
  openScheduleDrawer: (mode: 'create' | 'edit', schedule?: WorkflowSchedule | null) => void;
  setScheduleEditorOpen: (open: boolean) => void;
  handleScheduleSaved: (schedule: WorkflowSchedule, mode: 'create' | 'edit') => void;
  handleScheduleAction: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void>;
  handleScheduleDelete: (schedule: WorkflowSchedule) => Promise<void>;
  schedulePanelExpanded: boolean;
  setSchedulePanelExpanded: (open: boolean) => void;
}

export function useWorkflowSchedules({
  workflowId,
  toast,
}: UseWorkflowSchedulesOptions): UseWorkflowSchedulesResult {
  const queryClient = useQueryClient();
  const {
    data: schedules = [],
    isLoading,
    error: queryError,
  } = useSchedules(workflowId ? { workflowId } : undefined);
  const error = queryError?.message ?? null;

  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [scheduleEditorMode, setScheduleEditorMode] = useState<'create' | 'edit'>('create');
  const [editingSchedule, setEditingSchedule] = useState<WorkflowSchedule | null>(null);
  const [schedulePanelExpanded, setSchedulePanelExpanded] = useState(false);

  const refreshSchedules = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['schedules'] });
  }, [queryClient]);

  const openScheduleDrawer = useCallback(
    (mode: 'create' | 'edit', schedule?: WorkflowSchedule | null) => {
      if (!workflowId) {
        toast({
          title: 'Save workflow to manage schedules',
          description: 'Schedules can be created after the workflow has an ID.',
          variant: 'destructive',
        });
        return;
      }
      setScheduleEditorMode(mode);
      setEditingSchedule(schedule ?? null);
      setScheduleEditorOpen(true);
    },
    [toast, workflowId],
  );

  const handleScheduleSaved = useCallback(
    (_schedule: WorkflowSchedule, _mode: 'create' | 'edit') => {
      setScheduleEditorOpen(false);
      setEditingSchedule(null);
      void refreshSchedules();
    },
    [refreshSchedules],
  );

  const handleScheduleAction = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      try {
        if (action === 'pause') {
          await api.schedules.pause(schedule.id);
          toast({ title: 'Schedule paused', description: schedule.name });
        } else if (action === 'resume') {
          await api.schedules.resume(schedule.id);
          toast({ title: 'Schedule resumed', description: schedule.name });
        } else {
          await api.schedules.runNow(schedule.id);
          toast({ title: 'Schedule triggered', description: schedule.name });
        }
        void refreshSchedules();
      } catch (err) {
        toast({
          title: 'Schedule action failed',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'destructive',
        });
        throw err;
      }
    },
    [refreshSchedules, toast],
  );

  const handleScheduleDelete = useCallback(
    async (schedule: WorkflowSchedule) => {
      if (
        !confirm(
          `Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`,
        )
      ) {
        return;
      }
      try {
        await api.schedules.delete(schedule.id);
        toast({
          title: 'Schedule deleted',
          description: `"${schedule.name}" has been deleted.`,
        });
        void refreshSchedules();
      } catch (err) {
        toast({
          title: 'Failed to delete schedule',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'destructive',
        });
        throw err;
      }
    },
    [refreshSchedules, toast],
  );

  return {
    schedules,
    isLoading,
    error,
    refreshSchedules,
    scheduleEditorOpen,
    scheduleEditorMode,
    editingSchedule,
    openScheduleDrawer,
    setScheduleEditorOpen,
    handleScheduleSaved,
    handleScheduleAction,
    handleScheduleDelete,
    schedulePanelExpanded,
    setSchedulePanelExpanded,
  };
}
