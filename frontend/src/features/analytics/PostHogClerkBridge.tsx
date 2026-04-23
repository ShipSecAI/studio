import { useEffect } from 'react';
import posthog from 'posthog-js';
import { useAuth, useAuthProvider } from '@/auth/auth-context';
import { isAnalyticsEnabled } from './config';

/**
 * Bridges hosted auth state to PostHog identify/group calls.
 * Place under the active auth provider (see App.tsx) and above most routes.
 */
export function PostHogClerkBridge() {
  const provider = useAuthProvider();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || provider.name === 'local' || !isAnalyticsEnabled()) return;

    if (isAuthenticated && user) {
      const traits: Record<string, unknown> = {
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
        username: user.username,
      };

      try {
        posthog.identify(user.id, traits);
        if (user.organizationId) {
          posthog.group('organization', user.organizationId, {
            name: user.organizationName,
          });
        }
        posthog.reloadFeatureFlags();
      } catch (_) {
        // ignore
      }
    } else {
      // Clear user on sign-out
      try {
        posthog.reset();
      } catch (_) {
        // ignore
      }
    }
  }, [isAuthenticated, isLoading, provider.name, user]);

  return null;
}
