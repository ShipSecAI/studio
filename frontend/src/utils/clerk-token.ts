/**
 * Utility to get fresh Clerk tokens on-demand
 * This is used by the API client to fetch fresh tokens before each request
 */

let clerkGetToken: ((options?: { template?: string }) => Promise<string | null>) | null = null;

/**
 * Register Clerk's getToken function so it can be accessed by the API client
 */
export function registerClerkTokenGetter(
  getToken: (options?: { template?: string }) => Promise<string | null>,
) {
  clerkGetToken = getToken;
}

/**
 * Get a fresh Clerk token on-demand
 * Returns null if Clerk is not available or user is not authenticated
 */
export async function getFreshClerkToken(): Promise<string | null> {
  if (!clerkGetToken) {
    return null;
  }

  try {
    const jwtTemplate = (import.meta.env.VITE_CLERK_JWT_TEMPLATE || '').trim() || undefined;
    const token = await clerkGetToken(jwtTemplate ? { template: jwtTemplate } : undefined);
    return token;
  } catch (error) {
    console.error('[Clerk Token] Failed to get fresh token:', error);
    return null;
  }
}
