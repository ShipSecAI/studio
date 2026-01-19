import { createContext, useContext } from 'react';

// Context for entry point actions
export interface EntryPointActionsContextValue {
  onOpenScheduleSidebar?: () => void;
  onOpenWebhooksSidebar?: () => void;
  onScheduleCreate?: () => void;
}

export const EntryPointActionsContext = createContext<EntryPointActionsContextValue>({});
export const useEntryPointActions = () => useContext(EntryPointActionsContext);
