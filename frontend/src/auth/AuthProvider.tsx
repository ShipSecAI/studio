import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { FrontendAuthProvider, FrontendAuthProviderComponent } from './types';
import { useAuthStore } from '../store/authStore';
import { GlobalAuthContext } from './auth-context-def';

interface ExternalAuthModule {
  getFrontendAuthProviderComponent?: () => FrontendAuthProviderComponent;
}

function getExternalAuthModuleId(): string {
  return (import.meta.env.VITE_CLOUD_EXTENSION_PACKAGE as string | undefined)?.trim() || '';
}

function shouldUseExternalAuth(): boolean {
  const envProvider = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined)
    ?.trim()
    .toLowerCase();
  if (!envProvider || envProvider === 'local') {
    return false;
  }
  return getExternalAuthModuleId().length > 0;
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
      signOut: async () => {
        // Clear session cookie via backend logout endpoint
        // Use relative path to ensure we hit the same origin as login
        try {
          await fetch('/api/v1/auth/logout', {
            method: 'POST',
            credentials: 'include',
          });
        } catch (error) {
          console.warn('Failed to clear session cookie:', error);
        }
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

const PendingAuthProvider: FrontendAuthProviderComponent = ({ children, onProviderChange }) => {
  useEffect(() => {
    onProviderChange?.(null);
    return () => {
      onProviderChange?.(null);
    };
  }, [onProviderChange]);

  return <>{children}</>;
};

// Main auth provider component that selects the appropriate provider
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentProvider, setCurrentProvider] = useState<FrontendAuthProvider | null>(null);
  const [resolvedProviderName, setResolvedProviderName] = useState<string>(() =>
    shouldUseExternalAuth() ? 'cloud' : 'local',
  );
  const [ProviderComponent, setProviderComponent] = useState<FrontendAuthProviderComponent>(() =>
    shouldUseExternalAuth() ? PendingAuthProvider : LocalAuthProvider,
  );

  const handleProviderChange = useCallback((provider: FrontendAuthProvider | null) => {
    setCurrentProvider(provider);
  }, []);

  useEffect(() => {
    const externalModuleId = getExternalAuthModuleId();
    if (!shouldUseExternalAuth() || !externalModuleId) {
      setResolvedProviderName('local');
      setProviderComponent(() => LocalAuthProvider);
      return;
    }

    let cancelled = false;
    const target = externalModuleId.startsWith('/') ? `/@fs${externalModuleId}` : externalModuleId;

    import(/* @vite-ignore */ target)
      .then((mod) => {
        if (cancelled) {
          return;
        }

        const externalProvider = (mod as ExternalAuthModule).getFrontendAuthProviderComponent?.();
        if (externalProvider) {
          setResolvedProviderName('cloud');
          setProviderComponent(() => externalProvider);
          return;
        }

        console.warn(
          `[auth] External auth module "${externalModuleId}" did not export getFrontendAuthProviderComponent; falling back to local auth.`,
        );
        setResolvedProviderName('local');
        setProviderComponent(() => LocalAuthProvider);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.warn(`[auth] Failed to load external auth module "${externalModuleId}"`, error);
        setResolvedProviderName('local');
        setProviderComponent(() => LocalAuthProvider);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      provider: currentProvider,
      providerName: currentProvider?.name ?? resolvedProviderName,
    }),
    [currentProvider, resolvedProviderName],
  );

  return (
    <GlobalAuthContext.Provider value={contextValue}>
      <ProviderComponent onProviderChange={handleProviderChange}>{children}</ProviderComponent>
    </GlobalAuthContext.Provider>
  );
};
