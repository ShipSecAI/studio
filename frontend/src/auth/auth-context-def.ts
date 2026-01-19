import { createContext } from 'react';
import type { FrontendAuthProvider } from './types';

// Global auth context that wraps the selected provider
export const GlobalAuthContext = createContext<{
  provider: FrontendAuthProvider | null;
  providerName: string;
}>({
  provider: null,
  providerName: 'local',
});
