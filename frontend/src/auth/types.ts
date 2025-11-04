/**
 * Interface for frontend authentication providers
 * Makes auth system modular - can swap Clerk for other providers easily
 */

export interface FrontendAuthUser {
  id: string;
  email?: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string;
  organizationId?: string;
  organizationName?: string;
  organizationRole?: string;
  publicMetadata?: Record<string, any>;
}

export interface FrontendAuthToken {
  token: string;
  expiresAt?: number;
}

export interface FrontendAuthContext {
  user: FrontendAuthUser | null;
  token: FrontendAuthToken | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error?: string | null;
}

export interface FrontendAuthProvider {
  name: string;
  context: FrontendAuthContext;

  // Authentication methods
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;

  // UI components
  SignInComponent: React.ComponentType<any>;
  SignUpComponent: React.ComponentType<any>;
  UserButtonComponent: React.ComponentType<any>;
  OrganizationSwitcherComponent?: React.ComponentType<any>;

  // Lifecycle
  initialize: () => void;
  cleanup: () => void;
}

export type FrontendAuthProviderComponent = React.FC<{
  children: React.ReactNode;
  onProviderChange?: (provider: FrontendAuthProvider | null) => void;
}>;
