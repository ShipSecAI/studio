import { createContext, useContext, type ReactNode } from 'react'
import type { WorkflowSchedule } from '@shipsec/shared'

type ScheduleAction = 'pause' | 'resume' | 'run'

export interface WorkflowSchedulesContextValue {
  workflowId?: string | null
  schedules: WorkflowSchedule[]
  isLoading: boolean
  error: string | null
  onScheduleCreate: () => void
  onScheduleEdit: (schedule: WorkflowSchedule) => void
  onScheduleAction: (schedule: WorkflowSchedule, action: ScheduleAction) => Promise<void> | void
  onScheduleDelete: (schedule: WorkflowSchedule) => Promise<void> | void
  onViewSchedules: () => void
  onOpenScheduleSidebar: () => void
  onCloseScheduleSidebar: () => void
}

const WorkflowSchedulesContext = createContext<WorkflowSchedulesContextValue | undefined>(undefined)

export function WorkflowSchedulesProvider({
  value,
  children,
}: {
  value: WorkflowSchedulesContextValue
  children: ReactNode
}) {
  return <WorkflowSchedulesContext.Provider value={value}>{children}</WorkflowSchedulesContext.Provider>
}

export function useWorkflowSchedulesContext(): WorkflowSchedulesContextValue {
  const context = useContext(WorkflowSchedulesContext)
  if (!context) {
    throw new Error('useWorkflowSchedulesContext must be used within a WorkflowSchedulesProvider')
  }
  return context
}

export function useOptionalWorkflowSchedulesContext() {
  return useContext(WorkflowSchedulesContext)
}
