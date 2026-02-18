import { useEffect, useRef } from 'react';
import { useAuth, useAuthProvider } from './auth-context';
import { useAuthStore } from '../store/authStore';
import { queryClient } from '@/lib/queryClient';

/**
 * Hook to integrate the new auth system with the existing Zustand store
 * This ensures backward compatibility while transitioning to the new auth system
 */
export function useAuthStoreIntegration() {
  const { user, token, isAuthenticated, isLoading, error } = useAuth();
  const authProvider = useAuthProvider();
  const { setAuthContext, clear: clearStore } = useAuthStore();
  const organizationId = useAuthStore((s) => s.organizationId);
  const prevOrgRef = useRef(organizationId);

  // Clear query cache on logout
  useEffect(() => {
    if (!isAuthenticated) {
      queryClient.cancelQueries();
      queryClient.clear();
    }
  }, [isAuthenticated]);

  // Clear query cache on org change
  useEffect(() => {
    if (prevOrgRef.current !== organizationId) {
      queryClient.cancelQueries();
      queryClient.clear();
      prevOrgRef.current = organizationId;
    }
  }, [organizationId]);

  useEffect(() => {
    if (isLoading) {
      return; // Don't update store while loading
    }

    if (isAuthenticated && user && token) {
      // User is authenticated - update store with auth data
      const providerForStore =
        authProvider.name === 'clerk'
          ? 'clerk'
          : authProvider.name === 'local'
            ? 'local'
            : 'custom';

      // For Clerk: use selected org, or "user's workspace" if no org
      let organizationId: string | undefined;
      let roles: string[];

      if (authProvider.name === 'clerk') {
        organizationId = user.organizationId || `workspace-${user.id}`;

        // If user is in their own workspace, they are ADMIN by default
        if (organizationId === `workspace-${user.id}`) {
          roles = ['ADMIN'];
        } else {
          // If user has an organization role, use it
          // Otherwise, grant ADMIN as fallback (matches backend logic when JWT template doesn't include roles)
          if (user.organizationRole) {
            // Normalize Clerk role format (e.g., "org:admin" -> "ADMIN", "org_member" -> "MEMBER")
            let roleUpper = user.organizationRole.toUpperCase();
            // Remove "ORG:" prefix if present
            if (roleUpper.startsWith('ORG:')) {
              roleUpper = roleUpper.substring(4);
            }
            // Remove "ORG_" prefix if present
            if (roleUpper.startsWith('ORG_')) {
              roleUpper = roleUpper.substring(4);
            }
            roles = [roleUpper];
          } else {
            // No org_role in Clerk user object - grant ADMIN as fallback
            // This matches the backend behavior when JWT doesn't include org_role
            roles = ['ADMIN'];
          }
        }
      } else {
        organizationId = user.organizationId || undefined;
        roles = user.organizationRole ? [user.organizationRole.toUpperCase()] : ['MEMBER'];
      }

      setAuthContext({
        token: token.token,
        userId: user.id,
        organizationId,
        roles,
        provider: providerForStore,
      });
    } else if (!isAuthenticated) {
      // User is not authenticated - clear store but keep basic defaults
      clearStore();
    }

    // Handle auth errors
    if (error) {
      console.error('Authentication error:', error);
      // You might want to show a toast notification here
    }
  }, [
    authProvider.name,
    isAuthenticated,
    user,
    token,
    isLoading,
    error,
    setAuthContext,
    clearStore,
  ]);

  return {
    isLoading,
    isAuthenticated,
    error,
  };
}

/**
 * Hook to sync auth provider state with the backend API configuration
 * This ensures the frontend and backend are using the same auth provider
 */
export function useAuthProviderSync() {
  const { provider: storeProvider } = useAuthStore();
  const authProvider = useAuthProvider();
  const providerForStore = resolvedProviderForReturn(authProvider.name);

  useEffect(() => {
    // Check if frontend and backend auth providers are aligned
    const configuredFrontendProvider = (import.meta.env.VITE_AUTH_PROVIDER ||
      providerForStore) as string;
    const backendProvider = import.meta.env.VITE_API_AUTH_PROVIDER || configuredFrontendProvider;

    if (configuredFrontendProvider !== backendProvider) {
      console.warn(
        `Auth provider mismatch: frontend=${configuredFrontendProvider}, backend=${backendProvider}. ` +
          'This may cause authentication issues.',
      );
    }

    // Update store provider if needed
    if (storeProvider !== providerForStore) {
      useAuthStore.getState().setProvider(providerForStore);
    }
  }, [providerForStore, storeProvider]);

  return {
    provider: resolvedProviderForReturn(authProvider.name),
  };
}

function resolvedProviderForReturn(name: string): 'local' | 'clerk' | 'custom' {
  if (name === 'clerk') {
    return 'clerk';
  }
  if (name === 'local') {
    return 'local';
  }
  return 'custom';
}

/**
 * Migration utility to help transition from manual token management to provider-based auth
 */
export function useAuthMigration() {
  const { token: providerToken, isAuthenticated } = useAuth();
  const { token: storeToken, clear: clearStore } = useAuthStore();

  useEffect(() => {
    // If user has a manually set token in store but no provider auth,
    // we might need to migrate them
    if (storeToken && !isAuthenticated && !providerToken) {
      console.info(
        'Found existing token in store. You may need to sign in with the new auth system to continue.',
      );

      // Optionally, you could attempt to validate the existing token
      // or prompt the user to sign in again
    }
  }, [storeToken, isAuthenticated, providerToken]);

  const migrateToProviderAuth = () => {
    // Clear the old auth data and redirect to sign in
    clearStore();
    // This will trigger the auth flow
  };

  return {
    needsMigration: !!storeToken && !isAuthenticated,
    migrateToProviderAuth,
  };
}
