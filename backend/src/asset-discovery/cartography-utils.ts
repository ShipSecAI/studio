const CARTOGRAPHY_DB_PREFIX = 'cartography_org_';
const MAX_DATABASE_NAME_LENGTH = 63;

export function buildCartographyDatabaseName(organizationId: string): string {
  const sanitized = organizationId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const suffix = sanitized.length > 0 ? sanitized : 'default';
  const maxSuffixLength = MAX_DATABASE_NAME_LENGTH - CARTOGRAPHY_DB_PREFIX.length;

  return `${CARTOGRAPHY_DB_PREFIX}${suffix.slice(0, Math.max(maxSuffixLength, 1))}`;
}

export interface CartographySyncConnectionBinding {
  connectionId: string;
  accountIdentifier: string | null;
}

export function buildOrgAssetSyncWorkflowId(organizationId: string): string {
  return `asset-sync-org-${organizationId}`;
}
