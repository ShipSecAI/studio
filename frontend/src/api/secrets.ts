import { api } from '@/services/api';
import type { SecretSummary } from '@/schemas/secret';
export type { SecretSummary } from '@/schemas/secret';

export interface Secret {
  id: string;
  name?: string;
  description?: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch all available secrets from the secrets service
 */
export async function fetchSecrets(): Promise<SecretSummary[]> {
  try {
    return await api.secrets.list();
  } catch (error) {
    console.error('Failed to fetch secrets:', error);
    return [];
  }
}

/**
 * Fetch a specific secret by ID
 */
export async function fetchSecret(id: string): Promise<SecretSummary | null> {
  try {
    // Find the secret in the list since there's no direct get endpoint
    const secrets = await api.secrets.list();
    return secrets.find((secret) => secret.id === id) || null;
  } catch (error) {
    console.error(`Failed to fetch secret ${id}:`, error);
    return null;
  }
}

/**
 * Get human-readable secret label for dropdown display
 */
export function getSecretLabel(secret: SecretSummary): string {
  return secret.name || secret.id;
}

/**
 * Get secret description for dropdown subtitle
 */
export function getSecretDescription(secret: SecretSummary): string {
  return secret.description || `ID: ${secret.id}`;
}
