import { createRequire } from 'node:module';
import type { Type } from '@nestjs/common';
import { getBackendCloudModuleId } from './cloud-env';

type NestModule = Type<unknown>;
interface BackendCloudModule {
  getBackendCloudModules?: () => NestModule[];
}

const require = createRequire(import.meta.url);

export function loadBackendCloudModules(): NestModule[] {
  const moduleId = getBackendCloudModuleId() || './backend-cloud.stub';

  try {
    const loaded = require(moduleId) as BackendCloudModule;
    return loaded.getBackendCloudModules?.() ?? [];
  } catch (error) {
    if (getBackendCloudModuleId()) {
      console.warn(`[backend-cloud-loader] Failed to load "${moduleId}"`, error);
    }
    return [];
  }
}
