/**
 * Secret Resolution Utility
 *
 * Resolves secret references in strings and objects.
 * Secret reference format: {{secret:SECRET_ID}}
 */

import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import type { AuthContext } from '../auth/types';

const SECRET_REF_REGEX = /\{\{secret:([a-f0-9-]+)\}\}/gi;

export interface ResolveSecretsOptions {
  auth: AuthContext | null;
}

export interface ResolvedConfig {
  headers?: Record<string, string> | null;
  args?: string[] | null;
}

@Injectable()
export class SecretResolver {
  private readonly logger = new Logger(SecretResolver.name);

  constructor(private readonly secretsService: SecretsService) {}

  /**
   * Resolves all secret references in a string
   */
  async resolveString(value: string, options: ResolveSecretsOptions): Promise<string> {
    const { auth } = options;

    // Replace all {{secret:SECRET_ID}} references
    const replacements = new Map<string, string>();

    let match: RegExpExecArray | null;
    const regex = new RegExp(SECRET_REF_REGEX.source, SECRET_REF_REGEX.flags);

    while ((match = regex.exec(value)) !== null) {
      const secretId = match[1];
      if (!replacements.has(secretId)) {
        try {
          const secretValue = await this.secretsService.getSecretValue(auth, secretId);
          replacements.set(secretId, secretValue.value);
        } catch (error) {
          this.logger.error(`Failed to resolve secret ${secretId}:`, error);
          replacements.set(secretId, ''); // Replace with empty string on error
        }
      }
    }

    // Replace all occurrences using regex
    let result = value;
    replacements.forEach((resolvedValue, secretId) => {
      const refRegex = new RegExp(`\\{\\{secret:${secretId}\\}\\}`, 'gi');
      result = result.replace(refRegex, resolvedValue);
    });

    return result;
  }

  /**
   * Resolves secret references in a record (object) of strings
   */
  async resolveRecord(
    record: Record<string, string>,
    options: ResolveSecretsOptions,
  ): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(record)) {
      resolved[key] = await this.resolveString(value, options);
    }

    return resolved;
  }

  /**
   * Resolves secret references in an array of strings (e.g., args)
   */
  async resolveArray(array: string[], options: ResolveSecretsOptions): Promise<string[]> {
    const resolved: string[] = [];

    for (const item of array) {
      resolved.push(await this.resolveString(item, options));
    }

    return resolved;
  }

  /**
   * Resolves secrets in MCP server configuration
   */
  async resolveMcpConfig(
    headers: Record<string, string> | null | undefined,
    args: string[] | null | undefined,
    options: ResolveSecretsOptions,
  ): Promise<ResolvedConfig> {
    const result: ResolvedConfig = {};

    if (headers) {
      result.headers = await this.resolveRecord(headers, options);
    }

    if (args) {
      result.args = await this.resolveArray(args, options);
    }

    return result;
  }
}
