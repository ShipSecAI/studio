import type { FrontendCloudExtension } from './cloud-types';

export function getFrontendCloudExtension(): FrontendCloudExtension {
  return {
    routeComponents: null,
    navigationGroups: [],
    settingsItems: [],
  };
}
