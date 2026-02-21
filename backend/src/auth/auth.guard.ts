import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, Logger, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthContext } from './types';
import { DEFAULT_ROLES } from './types';
import { DEFAULT_ORGANIZATION_ID } from './constants';

export interface RequestWithAuthContext extends Request {
  auth?: AuthContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly authService: AuthService,
    @Inject(forwardRef(() => ApiKeysService))
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAuthContext>();
    if (!request) {
      return true;
    }

    // Try internal auth first (highest priority)
    const internalAuth = this.tryInternalAuth(request);
    if (internalAuth) {
      request.auth = internalAuth;
      this.logger.log(
        `[AUTH] Internal token accepted for ${request.method} ${request.path} (org=${internalAuth.organizationId ?? 'none'})`,
      );
      return true;
    }

    // Try API key auth before user auth (API keys use Bearer sk_* format)
    const apiKeyAuth = await this.tryApiKeyAuth(request);
    if (apiKeyAuth) {
      request.auth = apiKeyAuth;
      this.logger.log(
        `[AUTH] API key accepted for ${request.method} ${request.path} (org=${apiKeyAuth.organizationId ?? 'none'})`,
      );
      return true;
    }

    // Fall back to user authentication (Clerk/Local)
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
      request.header('x-organization-id') ?? request.header('x-org-id') ?? DEFAULT_ORGANIZATION_ID;

    return {
      userId: 'internal-service',
      organizationId,
      roles: DEFAULT_ROLES,
      isAuthenticated: true,
      provider: 'internal',
    };
  }

  private async tryApiKeyAuth(request: Request): Promise<AuthContext | null> {
    const authHeader = request.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer sk_')) {
      return null;
    }

    const token = authHeader.replace(/^Bearer\s+/, '');
    const apiKey = await this.apiKeysService.validateKey(token);

    if (!apiKey) {
      return null;
    }

    const permissions = (apiKey.permissions ?? {}) as any;
    const normalizedPermissions = {
      workflows: {
        run: Boolean(permissions.workflows?.run),
        list: Boolean(permissions.workflows?.list),
        read: Boolean(permissions.workflows?.read),
      },
      runs: {
        read: Boolean(permissions.runs?.read),
        cancel: Boolean(permissions.runs?.cancel),
      },
      audit: {
        read: Boolean(permissions.audit?.read),
      },
    };

    return {
      userId: apiKey.id,
      organizationId: apiKey.organizationId,
      roles: ['MEMBER'], // API keys have MEMBER role by default
      isAuthenticated: true,
      provider: 'api-key',
      apiKeyPermissions: normalizedPermissions,
    };
  }
}
