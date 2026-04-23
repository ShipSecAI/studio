import { useMemo } from 'react';
import type { FrontendCloudExtension } from './cloud-types';
import { getFrontendCloudExtension as getBundledFrontendCloudExtension } from '@shipsec/cloud-extension-runtime';

export function useFrontendCloudExtension(): FrontendCloudExtension {
  return useMemo(() => getBundledFrontendCloudExtension(), []);
}
