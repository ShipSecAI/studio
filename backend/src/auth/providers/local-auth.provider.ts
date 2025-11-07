import type { Request } from 'express';
import { Injectable, UnauthorizedException } from '@nestjs/common';

import type { LocalAuthConfig } from '../../config/auth.config';
import { DEFAULT_ROLES, type AuthContext } from '../types';
import type { AuthProviderStrategy } from './auth-provider.interface';
import { DEFAULT_ORGANIZATION_ID } from '../constants';

function extractBasicAuth(headerValue: string | undefined): { username: string; password: string } | null {
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

  constructor(private readonly config: LocalAuthConfig) {}

  async authenticate(request: Request): Promise<AuthContext> {
    // Always use local-dev org ID for local auth
    const orgId = DEFAULT_ORGANIZATION_ID;

    // Require Basic Auth (admin credentials)
    if (!this.config.adminUsername || !this.config.adminPassword) {
      throw new UnauthorizedException('Local auth not configured - admin credentials required');
    }

    const authHeader = request.headers.authorization;
    const basicAuth = extractBasicAuth(authHeader);
    
    if (!basicAuth) {
      throw new UnauthorizedException('Missing Basic Auth credentials');
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
