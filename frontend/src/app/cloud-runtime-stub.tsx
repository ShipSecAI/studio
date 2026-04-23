import type { FrontendCloudExtension } from './cloud-types';
import type { FrontendAuthProviderComponent } from '@/auth/types';

export function getFrontendCloudExtension(): FrontendCloudExtension {
  return {
    routeComponents: null,
    navigationGroups: [],
    settingsItems: [],
  };
}

export function getFrontendAuthProviderComponent(): FrontendAuthProviderComponent | undefined {
  return undefined;
}
