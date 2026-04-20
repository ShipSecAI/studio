import { useEffect, useState } from 'react';
import type { FrontendCloudExtension } from './cloud-types';

interface CloudExtensionModule {
  getFrontendCloudExtension: () => FrontendCloudExtension;
}

const cloudModules = import.meta.glob<CloudExtensionModule>('./cloud-*.tsx', { eager: true });

function getBundledFrontendCloudExtension(): FrontendCloudExtension {
  return cloudModules['./cloud-stub.tsx'].getFrontendCloudExtension();
}

export function useFrontendCloudExtension(): FrontendCloudExtension {
  const [extension, setExtension] = useState<FrontendCloudExtension>(() =>
    getBundledFrontendCloudExtension(),
  );

  useEffect(() => {
    const externalModuleId = (
      import.meta.env.VITE_CLOUD_EXTENSION_PACKAGE as string | undefined
    )?.trim();

    if (!externalModuleId) {
      return;
    }

    let cancelled = false;
    const target = externalModuleId.startsWith('/') ? `/@fs${externalModuleId}` : externalModuleId;

    import(/* @vite-ignore */ target)
      .then((mod) => {
        if (!cancelled && typeof mod.getFrontendCloudExtension === 'function') {
          setExtension(mod.getFrontendCloudExtension());
        }
      })
      .catch((error) => {
        console.warn(
          `[cloud-extension] Failed to load external frontend cloud extension "${externalModuleId}"`,
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return extension;
}
