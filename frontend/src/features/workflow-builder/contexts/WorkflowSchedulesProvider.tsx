import { type ReactNode } from 'react';
import {
  WorkflowSchedulesContext,
  type WorkflowSchedulesContextValue,
} from './WorkflowSchedulesContextDefinition';

export function WorkflowSchedulesProvider({
  value,
  children,
}: {
  value: WorkflowSchedulesContextValue;
  children: ReactNode;
}) {
  return (
    <WorkflowSchedulesContext.Provider value={value}>{children}</WorkflowSchedulesContext.Provider>
  );
}
