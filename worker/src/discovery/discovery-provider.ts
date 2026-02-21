/**
 * Discovery provider interface for cloud resource inventory.
 *
 * Providers implement cursor-based pagination to yield pages of assets.
 * Each page is independently retryable — on activity retry, the same cursor
 * is passed so discovery resumes from the last successful page.
 */

export interface DiscoveryProvider {
  /** Provider identifier (e.g., 'aws') */
  provider: string;
  /** Asset types this provider discovers (e.g., ['ecr_repository', 'ecr_image']) */
  assetTypes: string[];
  /** Discover a page of assets. Pass cursor from previous page to resume. */
  discover(context: DiscoveryContext, cursor?: string): Promise<DiscoveryPage>;
}

export interface DiscoveryPage {
  /** Assets discovered in this page (up to ~100) */
  assets: DiscoveredAsset[];
  /** Opaque cursor for next page. Undefined = done. */
  nextCursor?: string;
  /** Which regions were covered in this page */
  coveredRegions: string[];
  /** Which (assetType, region) pairs were actually scanned — used for exact-pair stale scoping */
  scannedScopes?: { assetType: string; region: string }[];
}

export interface DiscoveryContext {
  integrationId: string;
  organizationId: string;
  /** AWS credentials — resolved activity-locally, NEVER passed through Temporal */
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Stable AWS account ID (from connection metadata) */
  accountIdentifier: string;
  /** Regions to scan */
  regions: string[];
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface DiscoveredAsset {
  assetType: string;
  /** Deterministic ID (ARN format) — see externalId rules */
  externalId: string;
  name: string;
  region?: string;
  metadata: Record<string, unknown>;
}
