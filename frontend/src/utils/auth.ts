/**
 * Normalize a role name by removing common prefixes (ORG:, ORG_, etc.)
 */
export function normalizeRole(role: string): string {
  let normalized = role.toUpperCase();
  // Remove "ORG:" prefix if present
  if (normalized.startsWith('ORG:')) {
    normalized = normalized.substring(4);
  }
  // Remove "ORG_" prefix if present
  if (normalized.startsWith('ORG_')) {
    normalized = normalized.substring(4);
  }
  return normalized;
}

/**
 * Check if a user has admin role
 */
export function hasAdminRole(roles: string[]): boolean {
  return roles.some((role) => normalizeRole(role) === 'ADMIN');
}
