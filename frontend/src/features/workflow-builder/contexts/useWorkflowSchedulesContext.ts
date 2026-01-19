import { useContext } from 'react';
import {
  WorkflowSchedulesContext,
  type WorkflowSchedulesContextValue,
} from './WorkflowSchedulesContextDefinition';

export function useWorkflowSchedulesContext(): WorkflowSchedulesContextValue {
  const context = useContext(WorkflowSchedulesContext);
  if (!context) {
    throw new Error('useWorkflowSchedulesContext must be used within a WorkflowSchedulesProvider');
  }
  return context;
}

export function useOptionalWorkflowSchedulesContext() {
  return useContext(WorkflowSchedulesContext);
}
