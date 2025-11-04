import React, { useEffect, useMemo, useState } from 'react';
import {
  ClerkProvider as ClerkReactProvider,
  useAuth as useClerkAuth,
  useClerk,
  useUser,
  SignIn,
  SignUp,
  UserButton,
  OrganizationSwitcher,
} from '@clerk/clerk-react';

import type {
  FrontendAuthProvider,
  FrontendAuthUser,
  FrontendAuthToken
} from '../types';
import { registerClerkTokenGetter } from '../../utils/clerk-token';

const clerkConfig = {
  publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
  jwtTemplate: (import.meta.env.VITE_CLERK_JWT_TEMPLATE || '').trim() || undefined,
};

type ClerkProviderProps = {
  children: React.ReactNode;
  onProviderChange?: (provider: FrontendAuthProvider | null) => void;
};

export const ClerkAuthProvider: React.FC<ClerkProviderProps> = ({
  children,
  onProviderChange,
}) => {
  
  if (!clerkConfig.publishableKey) {
    console.warn('Clerk publishable key is not configured; skipping Clerk provider initialisation.');
    onProviderChange?.(null);
    return <>{children}</>;
  }

  
  return (
    <ClerkReactProvider publishableKey={clerkConfig.publishableKey}>
      <ClerkAuthBridge onProviderChange={onProviderChange}>{children}</ClerkAuthBridge>
    </ClerkReactProvider>
  );
};

function ClerkAuthBridge({
  children,
  onProviderChange,
}: ClerkProviderProps) {
  const { openSignIn, openSignUp, signOut } = useClerk();
  const { user } = useUser();
  const { isLoaded, isSignedIn, getToken, sessionId } = useClerkAuth();
  const [token, setToken] = useState<FrontendAuthToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Register getToken function so API client can fetch fresh tokens on-demand
    if (isLoaded && isSignedIn) {
      registerClerkTokenGetter(getToken);
    }
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    let cancelled = false;
    let refreshInterval: NodeJS.Timeout | null = null;

    async function syncToken() {
      if (!isLoaded || !isSignedIn) {
        if (!cancelled) {
          setToken(null);
          setError(null);
        }
        return;
      }

      try {
        // Always fetch fresh token - Clerk's getToken() handles refresh automatically
        // If skipCache is needed, we can add it here, but Clerk's SDK handles caching intelligently
        const jwt = await getToken(
          clerkConfig.jwtTemplate
            ? { template: clerkConfig.jwtTemplate }
            : undefined,
        );

        if (!cancelled) {
          if (jwt) {
            setToken({ token: jwt });
            setError(null);
          } else {
            setToken(null);
          }
        }
      } catch (err) {
        console.error('Failed to retrieve Clerk token', err);
        if (!cancelled) {
          setError('Failed to retrieve authentication token');
        }
      }
    }

    // Initial token fetch
    void syncToken();

    // Set up periodic token refresh (every 30 seconds to ensure tokens stay fresh)
    // Clerk tokens can expire quickly (especially in dev/test mode), so we refresh very frequently
    // to prevent unauthorized errors. Clerk's getToken() automatically handles token refresh.
    if (isLoaded && isSignedIn) {
      refreshInterval = setInterval(() => {
        if (!cancelled) {
          console.log('[Clerk Auth] Refreshing token (proactive refresh)...');
          void syncToken();
        }
      }, 30 * 1000); // 30 seconds - very frequent refresh to prevent expiration issues
    }

    return () => {
      cancelled = true;
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [getToken, isLoaded, isSignedIn, sessionId]);

  const clerkUser: FrontendAuthUser | null = useMemo(() => {
    if (!user) {
      return null;
    }

    const primaryOrg = user.organizationMemberships?.[0]?.organization;
    const primaryRole = user.organizationMemberships?.[0]?.role;

    return {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress ?? undefined,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      organizationId: primaryOrg?.id,
      organizationName: primaryOrg?.name,
      organizationRole: primaryRole ?? undefined,
      publicMetadata: user.publicMetadata ?? undefined,
    };
  }, [user]);

  const context = useMemo(
    () => ({
      user: clerkUser,
      token,
      isLoading: !isLoaded,
      isAuthenticated: Boolean(isSignedIn),
      error,
    }),
    [clerkUser, token, isLoaded, isSignedIn, error],
  );

  const clerkProvider = useMemo<FrontendAuthProvider>(
    () => ({
      name: 'clerk',
      context,
      signIn: () => openSignIn(),
      signUp: () => openSignUp(),
      signOut: async () => {
        try {
          await signOut();
        } catch (signOutError) {
          console.error('Failed to sign out from Clerk', signOutError);
        }
      },
      SignInComponent: ClerkSignInModal,
      SignUpComponent: ClerkSignUpModal,
      UserButtonComponent: ClerkUserButtonComponent,
      OrganizationSwitcherComponent: ClerkOrganizationSwitcherComponent,
      initialize: () => {
        /* Clerk manages its own lifecycle */
      },
      cleanup: () => {
        /* Clerk manages its own lifecycle */
      },
    }),
    [context, openSignIn, openSignUp, signOut],
  );

  useEffect(() => {
    onProviderChange?.(clerkProvider);
    return () => {
      onProviderChange?.(null);
    };
  }, [clerkProvider, onProviderChange]);

  return <>{children}</>;
}

// Clerk-specific UI Components
const ClerkSignInModal = ({ afterSignInUrl }: { afterSignInUrl?: string }) => (
  <SignIn
    routing="virtual"
    afterSignInUrl={afterSignInUrl || "/"}
    signUpUrl="/sign-up"
  />
);

const ClerkSignUpModal = ({ afterSignUpUrl }: { afterSignUpUrl?: string }) => (
  <SignUp
    routing="virtual"
    afterSignUpUrl={afterSignUpUrl || "/"}
    signInUrl="/sign-in"
  />
);

const ClerkUserButtonComponent = ({
  afterSignOutUrl,
  appearance
}: {
  afterSignOutUrl?: string;
  appearance?: any;
}) => (
  <UserButton
    afterSignOutUrl={afterSignOutUrl || "/"}
    appearance={{
      elements: {
        userButtonPopoverCard: 'shadow-lg',
        userButtonPopoverActionButton: 'hover:bg-accent',
        userButtonPopoverFooter: 'hidden', // Hide footer if not needed
        ...appearance?.elements,
      },
      ...appearance,
    }}
    // Enable organization list in UserButton dropdown - this shows orgs in the menu
    organizationListMode="navigation"
    organizationProfileMode="navigation"
    organizationProfileUrl="/organization"
    userProfileMode="navigation"
    userProfileUrl="/user"
  />
);

const ClerkOrganizationSwitcherComponent = ({
  appearance
}: {
  appearance?: any;
}) => (
  <OrganizationSwitcher
    appearance={appearance}
    hidePersonal={false}
    afterCreateOrganizationUrl="/"
    afterSelectOrganizationUrl="/"
    afterLeaveOrganizationUrl="/"
    organizationProfileMode="navigation"
    organizationProfileUrl="/organization"
    createOrganizationMode="navigation"
    createOrganizationUrl="/create-organization"
  />
);
