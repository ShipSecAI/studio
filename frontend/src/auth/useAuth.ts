import { useContext } from 'react';
import { GlobalAuthContext } from './auth-context-def';
import type { FrontendAuthProvider } from './types';

const FALLBACK_AUTH_PROVIDER: FrontendAuthProvider = {
  name: 'none',
  context: {
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
    error: 'No auth provider available',
  },
  signIn: () => console.warn('No auth provider available'),
  signUp: () => console.warn('No auth provider available'),
  signOut: () => console.warn('No auth provider available'),
  SignInComponent: () => null,
  SignUpComponent: () => null,
  UserButtonComponent: () => null,
  OrganizationSwitcherComponent: undefined,
  initialize: () => {},
  cleanup: () => {},
};

// Hook to get the current auth provider
export function useAuthProvider(): FrontendAuthProvider {
  const globalContext = useContext(GlobalAuthContext);
  if (globalContext.provider) {
    return globalContext.provider;
  }

  return FALLBACK_AUTH_PROVIDER;
}

// Hook to get auth context regardless of provider
export function useAuth() {
  const provider = useAuthProvider();
  return provider.context;
}
