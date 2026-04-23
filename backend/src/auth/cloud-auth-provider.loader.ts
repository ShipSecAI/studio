import { createRequire } from 'node:module';

import type { AuthProviderStrategy } from './providers/auth-provider.interface';
import { getBackendCloudModuleId } from '../composition/cloud-env';

type BackendAuthFactory = () => AuthProviderStrategy;

interface BackendCloudAuthModule {
  createBackendAuthProvider?: BackendAuthFactory;
  createAuthProviderStrategy?: BackendAuthFactory;
}

const require = createRequire(import.meta.url);

export function loadCloudAuthProvider(): AuthProviderStrategy | null {
  const authProvider = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  if (authProvider !== 'clerk') {
    return null;
  }

  const moduleId = getBackendCloudModuleId();
  if (!moduleId) {
    return null;
  }

  try {
    const loaded = require(moduleId) as BackendCloudAuthModule;
    const factory = loaded.createBackendAuthProvider ?? loaded.createAuthProviderStrategy;
    if (typeof factory === 'function') {
      return factory();
    }

    console.warn(
      `[auth] Cloud backend module "${moduleId}" loaded but no createBackendAuthProvider export was found.`,
    );
  } catch (error) {
    console.warn(`[auth] Failed to load cloud auth provider from "${moduleId}"`, error);
  }

  return null;
}
