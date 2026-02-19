import type { ApiKeyPermissions } from '../database/schema/api-keys';
export type { ApiKeyPermissions };

export type AuthRole = 'ADMIN' | 'MEMBER';

export interface AuthContext {
  userId: string | null;
  organizationId: string | null;
  roles: AuthRole[];
  isAuthenticated: boolean;
  provider: string;
  /** Present only when authenticated via API key. */
  apiKeyPermissions?: ApiKeyPermissions;
}

export const DEFAULT_ROLES: AuthRole[] = ['ADMIN', 'MEMBER'];
