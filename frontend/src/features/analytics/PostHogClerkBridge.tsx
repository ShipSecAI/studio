import { useEffect } from 'react'
import posthog from 'posthog-js'
import { useUser, useAuth } from '@clerk/clerk-react'
import { useAuthProvider } from '@/auth/auth-context'
import { isAnalyticsEnabled } from './config'

/**
 * Bridges Clerk auth state to PostHog identify/group calls.
 * Place under the Clerk provider (see App.tsx) and above most routes.
 */
export function PostHogClerkBridge() {
  const provider = useAuthProvider()
  if (provider.name !== 'clerk' || !isAnalyticsEnabled()) return null
  return <ClerkBridgeInner />
}

function ClerkBridgeInner() {
  const { user, isLoaded } = useUser()
  const { isSignedIn } = useAuth()

  useEffect(() => {
    if (!isLoaded) return

    if (isSignedIn && user) {
      const primaryOrg = user.organizationMemberships?.[0]?.organization
      const traits: Record<string, unknown> = {
        email: user.primaryEmailAddress?.emailAddress,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
        username: user.username,
      }

      try {
        posthog.identify(user.id, traits)
        if (primaryOrg?.id) {
          posthog.group('organization', primaryOrg.id, {
            name: primaryOrg.name,
          })
        }
      } catch (_) {
        // ignore
      }
    } else {
      // Clear user on sign-out
      try {
        posthog.reset()
      } catch (_) {
        // ignore
      }
    }
  }, [isLoaded, isSignedIn, user])

  return null
}
