import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ClerkAuthProvider } from './providers/clerk-provider';
import type { FrontendAuthProvider, FrontendAuthProviderComponent } from './types';
import { useAuthStore } from '../store/authStore';
import { GlobalAuthContext } from './auth-context-def';

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
    return 'local';
  }

  // If explicitly set to 'local', always use local auth
  if (envProvider === 'local') {
    return 'local';
  }

  // If explicitly set to clerk, use it (if key is available)
  if (envProvider === 'clerk') {
    if (!hasClerkKey) {
      console.warn(
        'Auth provider set to Clerk, but no publishable key configured. Falling back to local auth.',
      );
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

type ProviderComponentProps = React.PropsWithChildren<{
  onProviderChange?: (provider: FrontendAuthProvider | null) => void;
}>;

// Local auth provider for development
const LocalAuthProvider: FrontendAuthProviderComponent = ({
  children,
  onProviderChange,
}: ProviderComponentProps) => {
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
  const ProviderComponent = authProviders[providerName] ?? LocalAuthProvider;

  const handleProviderChange = useCallback((provider: FrontendAuthProvider | null) => {
    setCurrentProvider(provider);
  }, []);

  const contextValue = useMemo(
    () => ({
      provider: currentProvider,
      providerName,
    }),
    [currentProvider, providerName],
  );

  return (
    <GlobalAuthContext.Provider value={contextValue}>
      <ProviderComponent onProviderChange={handleProviderChange}>{children}</ProviderComponent>
    </GlobalAuthContext.Provider>
  );
};
