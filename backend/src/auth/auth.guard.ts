import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import type { AuthContext } from './types';
import { DEFAULT_ROLES } from './types';
import { DEFAULT_ORGANIZATION_ID } from './constants';

export interface RequestWithAuthContext extends Request {
  auth?: AuthContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAuthContext>();
    if (!request) {
      return true;
    }

    const internalAuth = this.tryInternalAuth(request);
    if (internalAuth) {
      request.auth = internalAuth;
      this.logger.log(
        `[AUTH] Internal token accepted for ${request.method} ${request.path} (org=${internalAuth.organizationId ?? 'none'})`,
      );
      return true;
    }

    this.logger.log(
      `[AUTH] Guard activating for ${request.method} ${request.path} - Provider: ${this.authService.providerName}`,
    );

    try {
      request.auth = await this.authService.authenticate(request);
      this.logger.log(
        `[AUTH] Guard result - User: ${request.auth.userId}, Org: ${request.auth.organizationId}, Roles: [${request.auth.roles.join(', ')}], Authenticated: ${request.auth.isAuthenticated}`,
      );
    } catch (error) {
      this.logger.error(
        `[AUTH] Authentication failed for ${request.method} ${request.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    return true;
  }

  private tryInternalAuth(request: Request): AuthContext | null {
    const provided = request.header('x-internal-token');
    const expected = process.env.INTERNAL_SERVICE_TOKEN;

    if (!provided || !expected) {
      return null;
    }

    if (provided !== expected) {
      throw new UnauthorizedException('Invalid internal access token');
    }

    const organizationId =
      request.header('x-organization-id') ??
      request.header('x-org-id') ??
      DEFAULT_ORGANIZATION_ID;

    return {
      userId: 'internal-service',
      organizationId,
      roles: DEFAULT_ROLES,
      isAuthenticated: true,
      provider: 'internal',
    };
  }
}
