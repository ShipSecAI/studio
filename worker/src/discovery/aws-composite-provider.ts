/**
 * AWS composite discovery provider.
 *
 * Routes discovery through multiple AwsServiceProviders sequentially,
 * using a CompositeCursor to track position across services.
 * Merges scannedScopes from all sub-providers for accurate stale marking.
 */

import type {
  DiscoveryProvider,
  DiscoveryContext,
  DiscoveryPage,
  DiscoveredAsset,
} from './discovery-provider';
import type { AwsServiceProvider, CompositeCursor } from './aws-service-provider';

export class AwsCompositeProvider implements DiscoveryProvider {
  provider = 'aws';

  private services: AwsServiceProvider[] = [];

  get assetTypes(): string[] {
    return this.services.flatMap((s) => s.assetTypes);
  }

  registerService(service: AwsServiceProvider): void {
    this.services.push(service);
  }

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<DiscoveryPage> {
    const cursor: CompositeCursor = cursorStr ? JSON.parse(cursorStr) : { serviceIndex: 0 };

    const allAssets: DiscoveredAsset[] = [];
    const allScannedScopes: { assetType: string; region: string }[] = [];
    const coveredRegions = new Set<string>();
    let { serviceIndex, serviceCursor } = cursor;

    while (serviceIndex < this.services.length) {
      const service = this.services[serviceIndex];

      try {
        const page = await service.discover(context, serviceCursor);

        allAssets.push(...page.assets);
        allScannedScopes.push(...page.scannedScopes);

        for (const scope of page.scannedScopes) {
          coveredRegions.add(scope.region);
        }

        if (page.nextCursor) {
          // More pages in this service — return composite cursor
          const nextCursor: CompositeCursor = {
            serviceIndex,
            serviceCursor: page.nextCursor,
          };
          return {
            assets: allAssets,
            nextCursor: JSON.stringify(nextCursor),
            coveredRegions: Array.from(coveredRegions),
            scannedScopes: allScannedScopes,
          };
        }

        // This service is done, move to next
        serviceIndex++;
        serviceCursor = undefined;
      } catch (error: any) {
        // AccessDenied → skip this service entirely, don't add its scopes
        if (isAccessDenied(error)) {
          console.warn(
            `[AwsCompositeProvider] AccessDenied for service ${service.serviceId}, skipping`,
          );
          serviceIndex++;
          serviceCursor = undefined;
          continue;
        }
        throw error;
      }
    }

    // All services exhausted
    return {
      assets: allAssets,
      nextCursor: undefined,
      coveredRegions: Array.from(coveredRegions),
      scannedScopes: allScannedScopes,
    };
  }
}

function isAccessDenied(error: any): boolean {
  const name = error?.name ?? '';
  const code = error?.Code ?? error?.code ?? '';
  return (
    name === 'AccessDeniedException' ||
    name === 'UnauthorizedAccess' ||
    code === 'AccessDenied' ||
    code === 'AccessDeniedException' ||
    error?.$metadata?.httpStatusCode === 403
  );
}
