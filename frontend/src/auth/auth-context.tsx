import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from 'react';
import { ClerkAuthProvider } from './providers/clerk-provider';
import type { FrontendAuthProvider, FrontendAuthProviderComponent } from './types';
import { useAuthStore } from '../store/authStore';

// Auth provider registry - easy to add new providers
// Determine which provider to use based on environment
function getAuthProviderName(): string {
  // Priority: explicit 'local' > dev mode (always local) > environment variable
  const envProvider = import.meta.env.VITE_AUTH_PROVIDER;
  const hasClerkKey =
    typeof import.meta.env.VITE_CLERK_PUBLISHABLE_KEY === 'string' &&
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY.trim().length > 0;

  // In dev mode, always use local auth for testing (ignore Clerk settings)
  if (import.meta.env.DEV) {
    console.log('[Auth] Dev mode detected - using local auth provider');
    return 'local';
  }

  // Debug logging to help diagnose issues
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  console.log('[Auth] Provider selection:', {
    envProvider: envProvider || 'undefined',
    hasClerkKey,
    clerkKeyPreview: hasClerkKey && typeof clerkKey === 'string' ? clerkKey.substring(0, 20) + '...' : 'missing',
    allEnvKeys: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')),
  });
  console.log('[Auth] VITE_AUTH_PROVIDER value:', import.meta.env.VITE_AUTH_PROVIDER);
  console.log('[Auth] VITE_CLERK_PUBLISHABLE_KEY exists:', !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  // If explicitly set to 'local', always use local auth
  if (envProvider === 'local') {
    return 'local';
  }

  // If explicitly set to clerk, use it (if key is available)
  if (envProvider === 'clerk') {
    if (!hasClerkKey) {
      console.warn('Auth provider set to Clerk, but no publishable key configured. Falling back to local auth.');
      return 'local';
    }
    return 'clerk';
  }

  // If explicitly set to another provider, use it
  if (envProvider && authProviders[envProvider]) {
    return envProvider;
  }

  // In production, use Clerk if key is available, otherwise local
  if (hasClerkKey) {
    return 'clerk';
  }

  // Final fallback to local
  return 'local';
}

// Global auth context that wraps the selected provider
const GlobalAuthContext = createContext<{
  provider: FrontendAuthProvider | null;
  providerName: string;
}>({
  provider: null,
  providerName: 'local',
});

type ProviderComponentProps = React.PropsWithChildren<{
  onProviderChange?: (provider: FrontendAuthProvider | null) => void;
}>;

// Local auth provider for development
const LocalAuthProvider: FrontendAuthProviderComponent = ({ children, onProviderChange }: ProviderComponentProps) => {
  // Access auth store state
  const adminUsername = useAuthStore((state) => state.adminUsername);
  const adminPassword = useAuthStore((state) => state.adminPassword);
  const userId = useAuthStore((state) => state.userId);
  const organizationId = useAuthStore((state) => state.organizationId);

  // Create provider that reacts to store state
  const localProvider = useMemo<FrontendAuthProvider>(() => {
    const hasCredentials = !!(adminUsername && adminPassword);
    
    return {
      name: 'local',
      context: {
        user: hasCredentials
          ? {
              id: userId || 'admin',
              organizationId: organizationId || 'local-dev',
              organizationRole: 'ADMIN',
            }
          : null,
        token: hasCredentials
          ? {
              token: `basic-${btoa(`${adminUsername}:${adminPassword}`)}`,
              expiresAt: undefined,
            }
          : null,
        isLoading: false,
        isAuthenticated: hasCredentials,
        error: null,
      },
      signIn: () => {
        console.warn('Local auth: signIn not implemented - use AdminLoginForm');
      },
      signUp: () => {
        console.warn('Local auth: signUp not implemented');
      },
      signOut: () => {
        // Clear admin credentials from store
        useAuthStore.getState().clear();
      },
      SignInComponent: () => <div>Sign in not available in local dev mode</div>,
      SignUpComponent: () => <div>Sign up not available in local dev mode</div>,
      UserButtonComponent: () => <div>User profile not available in local dev mode</div>,
      OrganizationSwitcherComponent: undefined,
      initialize: () => {
        // No initialization required for local auth
      },
      cleanup: () => {
        // No cleanup needed for local auth
      },
    };
  }, [adminUsername, adminPassword, userId, organizationId]);

  useEffect(() => {
    localProvider.initialize();
    onProviderChange?.(localProvider);

    return () => {
      localProvider.cleanup();
      onProviderChange?.(null);
    };
  }, [localProvider, onProviderChange]);

  return <>{children}</>;
};

const authProviders: Record<string, FrontendAuthProviderComponent> = {
  clerk: ClerkAuthProvider,
  local: LocalAuthProvider,
  // Future providers can be added here:
  // auth0: Auth0AuthProvider,
  // firebase: FirebaseAuthProvider,
};

// Main auth provider component that selects the appropriate provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const providerName = getAuthProviderName();
  const [currentProvider, setCurrentProvider] = useState<FrontendAuthProvider | null>(null);
  const ProviderComponent =
    authProviders[providerName] ?? LocalAuthProvider;

  const handleProviderChange = useCallback(
    (provider: FrontendAuthProvider | null) => {
      setCurrentProvider(provider);
    },
    [],
  );

  const contextValue = useMemo(
    () => ({
      provider: currentProvider,
      providerName,
    }),
    [currentProvider, providerName],
  );

  return (
    <GlobalAuthContext.Provider value={contextValue}>
      <ProviderComponent onProviderChange={handleProviderChange}>
        {children}
      </ProviderComponent>
    </GlobalAuthContext.Provider>
  );
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
  SignInComponent: () => <div>No auth provider available</div>,
  SignUpComponent: () => <div>No auth provider available</div>,
  UserButtonComponent: () => <div>No auth provider available</div>,
  OrganizationSwitcherComponent: undefined,
  initialize: () => {},
  cleanup: () => {},
};

// Export provider names for type safety
export const AUTH_PROVIDERS = {
  CLERK: 'clerk',
  LOCAL: 'local',
  AUTH0: 'auth0', // Future
  FIREBASE: 'firebase', // Future
} as const;

export type AuthProviderName = keyof typeof AUTH_PROVIDERS;
