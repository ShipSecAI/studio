import { createContext } from 'react';
import type { WorkflowSchedule } from '@shipsec/shared';

type ScheduleAction = 'pause' | 'resume' | 'run';

export interface WorkflowSchedulesContextValue {
  workflowId?: string | null;
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error: string | null;
  onScheduleCreate: () => void;
  onScheduleEdit: (schedule: WorkflowSchedule) => void;
  onScheduleAction: (schedule: WorkflowSchedule, action: ScheduleAction) => Promise<void> | void;
  onScheduleDelete: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules: () => void;
  onOpenScheduleSidebar: () => void;
  onCloseScheduleSidebar: () => void;
  onOpenWebhooksSidebar?: () => void;
}

export const WorkflowSchedulesContext = createContext<WorkflowSchedulesContextValue | undefined>(
  undefined,
);
