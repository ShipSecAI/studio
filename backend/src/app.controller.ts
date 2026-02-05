import { Controller, Get, Logger, Post, Res, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AppService } from './app.service';
import { CurrentAuth } from './auth/auth-context.decorator';
import type { AuthContext } from './auth/types';
import { Public } from './auth/public.decorator';
import type { AuthConfig } from './config/auth.config';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  createSessionToken,
} from './auth/session.utils';
import { OpenSearchTenantService } from './analytics/opensearch-tenant.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly authCfg: AuthConfig;
  /** Track org provisioning state: resolved promises for completed orgs, pending promises for in-flight */
  private readonly provisioningOrgs = new Map<string, Promise<boolean>>();

  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
    private readonly tenantService: OpenSearchTenantService,
  ) {
    this.authCfg = this.configService.get<AuthConfig>('auth')!;
  }

  @SkipThrottle()
  @Get('/health')
  health() {
    return this.appService.getHealth();
  }

  /**
   * Auth validation endpoint for nginx auth_request.
   * Returns 200 if authenticated, 401 otherwise.
   * Used by nginx to protect /analytics/* routes.
   *
   * Response headers (for nginx tenant isolation):
   * - X-Auth-Organization-Id: lowercase normalized org ID (empty if no org context)
   * - X-Auth-User-Id: user identifier
   *
   * Note: SkipThrottle is required because nginx sends an auth_request
   * for every resource loaded from /analytics/*, which can quickly
   * exceed rate limits and cause 500 errors.
   */
  @SkipThrottle()
  @Get('/auth/validate')
  validateAuth(
    @CurrentAuth() auth: AuthContext | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException();
    }

    // Set headers for nginx tenant isolation
    // Canonicalize orgId to lowercase for consistent tenant naming
    const normalizedOrgId = auth.organizationId?.toLowerCase() || '';
    res.setHeader('X-Auth-Organization-Id', normalizedOrgId);
    res.setHeader('X-Auth-User-Id', auth.userId || '');

    // Ensure OpenSearch tenant exists for this org (fire-and-forget, cached)
    // Uses a Map of promises so: (1) concurrent requests share the same in-flight provisioning,
    // (2) failures are removed from cache to allow retry on next auth request.
    if (normalizedOrgId && !this.provisioningOrgs.has(normalizedOrgId)) {
      const promise = this.tenantService.ensureTenantExists(normalizedOrgId).then(
        (success) => {
          if (!success) {
            // Provisioning returned false (validation error, etc.) — allow retry
            this.provisioningOrgs.delete(normalizedOrgId);
          }
          return success;
        },
        (err) => {
          // Remove from cache so it retries next request
          this.provisioningOrgs.delete(normalizedOrgId);
          this.logger.error(
            `Failed to provision OpenSearch tenant for ${normalizedOrgId}: ${err}`,
          );
          return false;
        },
      );
      this.provisioningOrgs.set(normalizedOrgId, promise);
    }

    return { valid: true };
  }

  /**
   * Login endpoint for local auth.
   * Validates Basic auth credentials and sets a session cookie.
   */
  @Public()
  @Post('/auth/login')
  login(
    @Headers('authorization') authHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Only for local auth provider
    if (this.authCfg.provider !== 'local') {
      throw new UnauthorizedException('Login endpoint only available for local auth');
    }

    // Validate Basic auth header
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing Basic Auth credentials');
    }

    const base64Credentials = authHeader.slice(6);
    let username: string;
    let password: string;

    try {
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      [username, password] = credentials.split(':');
    } catch {
      throw new UnauthorizedException('Invalid Basic Auth format');
    }

    if (!username || !password) {
      throw new UnauthorizedException('Invalid Basic Auth format');
    }

    // Validate credentials
    if (
      username !== this.authCfg.local.adminUsername ||
      password !== this.authCfg.local.adminPassword
    ) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    // Create session token and set cookie
    const sessionToken = createSessionToken(username);

    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: '/',
    });

    return { success: true, message: 'Logged in successfully' };
  }

  /**
   * Logout endpoint for local auth.
   * Clears the session cookie.
   */
  @Public()
  @Post('/auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { success: true, message: 'Logged out successfully' };
  }
}
