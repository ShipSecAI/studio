import type { Request } from 'express';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';

import type { LocalAuthConfig } from '../../config/auth.config';
import { DEFAULT_ROLES, type AuthContext } from '../types';
import type { AuthProviderStrategy } from './auth-provider.interface';
import { DEFAULT_ORGANIZATION_ID } from '../constants';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../session.utils';

function extractBasicAuth(
  headerValue: string | undefined,
): { username: string; password: string } | null {
  if (!headerValue || !headerValue.startsWith('Basic ')) {
    return null;
  }
  try {
    const base64Credentials = headerValue.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');
    if (!username || !password) {
      return null;
    }
    return { username, password };
  } catch {
    return null;
  }
}

@Injectable()
export class LocalAuthProvider implements AuthProviderStrategy {
  readonly name = 'local';
  private readonly logger = new Logger(LocalAuthProvider.name);

  constructor(private readonly config: LocalAuthConfig) {}

  async authenticate(request: Request): Promise<AuthContext> {
    // Always use local-dev org ID for local auth
    const orgId = DEFAULT_ORGANIZATION_ID;

    // Check config
    if (!this.config.adminUsername || !this.config.adminPassword) {
      throw new UnauthorizedException('Local auth not configured - admin credentials required');
    }

    // Try session cookie first (for browser navigation requests like /analytics/)
    const sessionCookie = request.cookies?.[SESSION_COOKIE_NAME];
    if (sessionCookie) {
      const session = verifySessionToken(sessionCookie);
      if (session && session.username === this.config.adminUsername) {
        this.logger.debug(`Session cookie auth successful for user: ${session.username}`);
        return {
          userId: 'admin',
          organizationId: orgId,
          roles: DEFAULT_ROLES,
          isAuthenticated: true,
          provider: this.name,
        };
      }
      this.logger.debug('Session cookie invalid or username mismatch');
    }

    // Fall back to Basic Auth (for API requests)
    const authHeader = request.headers.authorization;
    const basicAuth = extractBasicAuth(authHeader);

    if (!basicAuth) {
      throw new UnauthorizedException(
        'Missing authentication - provide session cookie or Basic Auth',
      );
    }

    if (
      basicAuth.username !== this.config.adminUsername ||
      basicAuth.password !== this.config.adminPassword
    ) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    return {
      userId: 'admin',
      organizationId: orgId,
      roles: DEFAULT_ROLES,
      isAuthenticated: true,
      provider: this.name,
    };
  }
}
