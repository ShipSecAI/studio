/**
 * AWS service-level provider interface.
 *
 * Each sub-provider discovers assets from a single AWS service (IAM, S3, EC2, etc.).
 * The AwsCompositeProvider orchestrates multiple sub-providers behind the top-level
 * DiscoveryProvider interface.
 */

import type { DiscoveryContext, DiscoveredAsset } from './discovery-provider';

export interface AwsServiceProvider {
  /** Unique service identifier (e.g., 'ecr', 'iam', 's3') */
  serviceId: string;
  /** Asset types this service discovers (e.g., ['ecr_repository', 'ecr_image']) */
  assetTypes: string[];
  /** Whether this service uses a single global endpoint (IAM, S3, Route53, CloudFront) */
  isGlobal: boolean;
  /** Discover a page of assets. Returns scannedScopes for stale tracking. */
  discover(context: DiscoveryContext, cursor?: string): Promise<ServiceDiscoveryPage>;
}

export interface ServiceDiscoveryPage {
  /** Discovered assets */
  assets: DiscoveredAsset[];
  /** Opaque cursor for next page within this service. Undefined = done. */
  nextCursor?: string;
  /** Which (assetType, region) pairs were actually scanned in this page */
  scannedScopes: { assetType: string; region: string }[];
}

/**
 * Composite cursor that tracks position across multiple service providers.
 */
export interface CompositeCursor {
  /** Index into the ordered list of service providers */
  serviceIndex: number;
  /** Inner cursor for the current service provider */
  serviceCursor?: string;
}
