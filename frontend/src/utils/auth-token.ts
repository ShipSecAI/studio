let authGetToken: (() => Promise<string | null>) | null = null;

export function registerAuthTokenGetter(getToken: (() => Promise<string | null>) | null): void {
  authGetToken = getToken;
}

export async function getFreshAuthToken(): Promise<string | null> {
  if (!authGetToken) {
    return null;
  }

  try {
    return await authGetToken();
  } catch (error) {
    console.error('[Auth Token] Failed to get fresh token:', error);
    return null;
  }
}
