import type { Request } from 'express';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { JwtPayload } from '@clerk/types';

import type { ClerkAuthConfig } from '../../config/auth.config';
import type { AuthContext, AuthRole } from '../types';
import type { AuthProviderStrategy } from './auth-provider.interface';

type ClerkJwt = JwtPayload & {
  org_id?: string;
  organization_id?: string;
  org_role?: string;
  o?: { id?: string };
};

@Injectable()
export class ClerkAuthProvider implements AuthProviderStrategy {
  readonly name = 'clerk';
  private readonly logger = new Logger(ClerkAuthProvider.name);

  constructor(private readonly config: ClerkAuthConfig) {}

  async authenticate(request: Request): Promise<AuthContext> {
    this.logger.log(`[AUTH] Clerk authenticate called for ${request.method} ${request.path}`);

    if (!this.config.secretKey) {
      throw new ServiceUnavailableException(
        'Clerk auth provider requires CLERK_SECRET_KEY to be configured',
      );
    }

    const token = this.extractBearerToken(request);
    if (!token) {
      this.logger.warn(`[AUTH] Missing Clerk bearer token for ${request.method} ${request.path}`);
      this.logger.log(
        `[AUTH] Authorization header: ${request.headers.authorization ? 'present' : 'missing'}`,
      );
      throw new UnauthorizedException('Missing Clerk bearer token');
    }

    this.logger.log(`[AUTH] Token extracted (length: ${token.length}), verifying...`);
    const payload = await this.verifyClerkToken(token);
    this.logger.log(`[AUTH] Token verified successfully for user: ${payload.sub}`);

    const clerkUserId = payload.sub;

    // Resolve organization: prefer header, then JWT payload, then default to user's workspace
    const organizationId = this.resolveOrganizationId(request, payload, clerkUserId);
    const roles = this.resolveRoles(payload, organizationId, clerkUserId);

    this.logger.log(
      `[AUTH] Authentication successful - User: ${clerkUserId}, Org: ${organizationId}, Roles: [${roles.join(', ')}]`,
    );

    return {
      userId: clerkUserId,
      organizationId,
      roles,
      isAuthenticated: true,
      provider: this.name,
    };
  }

  private async verifyClerkToken(token: string): Promise<ClerkJwt> {
    try {
      this.logger.log('[AUTH] Verifying token');

      // Add clock skew tolerance to handle server clock differences
      // Clerk tokens can have iat in the future due to clock skew between servers
      const payload = (await verifyToken(token, {
        secretKey: this.config.secretKey!,
        // Allow up to 60 seconds of clock skew (tokens issued up to 60s in the future are acceptable)
        clockSkewInMs: 60 * 1000,
      })) as ClerkJwt;

      this.logger.log(
        `[AUTH] Token verified - User ID: ${payload.sub}, Org: ${payload.o?.id || payload.org_id || 'none'}, Role: ${payload.org_role || 'none'}`,
      );

      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AUTH] Clerk token verification failed: ${message}`);
      this.logger.error(`[AUTH] Secret key configured: ${this.config.secretKey ? 'yes' : 'no'}`);
      throw new UnauthorizedException('Invalid Clerk token');
    }
  }

  private extractBearerToken(request: Request): string | null {
    // Priority 1: Authorization header (API calls from frontend)
    const header =
      request.headers.authorization ?? (request.headers.Authorization as string | undefined);
    if (header) {
      const [scheme, token] = header.split(' ');
      if (scheme && token && scheme.toLowerCase() === 'bearer') {
        return token.trim();
      }
    }

    // Priority 2: Clerk's __session cookie (browser navigations like /analytics/)
    // Clerk's JS SDK sets this cookie on the app's domain; it contains a verifiable JWT
    const sessionCookie = request.cookies?.['__session'];
    if (sessionCookie) {
      this.logger.log(`[AUTH] No Authorization header, falling back to Clerk __session cookie`);
      return sessionCookie;
    }

    return null;
  }

  /**
   * Resolves organization ID with validation:
   * 1. If X-Organization-Id header matches JWT's org_id → trust it
   * 2. If header is workspace-{userId} → trust it (personal workspace)
   * 3. If header specifies different org than JWT → IGNORE it, log security warning
   * 4. Fall through to JWT org or workspace default
   *
   * Security: This prevents spoofed X-Organization-Id headers from accessing
   * other organizations' data. The JWT's org_id is the source of truth.
   */
  private resolveOrganizationId(request: Request, payload: ClerkJwt, userId: string): string {
    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const jwtOrg = payload.o?.id || payload.org_id || payload.organization_id;
    const userWorkspace = `workspace-${userId}`;

    this.logger.log(
      `[AUTH] Resolving org - Header: ${headerOrg || 'not present'}, JWT org: ${jwtOrg || 'none'}, User: ${userId}`,
    );

    // If header is provided, validate it
    if (headerOrg && headerOrg.trim().length > 0) {
      const trimmedHeader = headerOrg.trim();

      // Case 1: Header matches JWT org → trust it
      if (jwtOrg && trimmedHeader === jwtOrg) {
        this.logger.log(`[AUTH] Header matches JWT org, using: ${trimmedHeader}`);
        return trimmedHeader;
      }

      // Case 2: Header is user's personal workspace → trust it
      if (trimmedHeader === userWorkspace) {
        this.logger.log(`[AUTH] Header is user's workspace, using: ${trimmedHeader}`);
        return trimmedHeader;
      }

      // Case 3: Header specifies a DIFFERENT org than JWT → IGNORE and log security warning
      if (jwtOrg && trimmedHeader !== jwtOrg) {
        this.logger.warn(
          `[AUTH] SECURITY: X-Organization-Id header "${trimmedHeader}" does not match JWT org "${jwtOrg}". ` +
            `User ${userId} may be attempting cross-tenant access. Ignoring header.`,
        );
        // Fall through to use JWT org
      }

      // Case 4: No JWT org but header is not user's workspace → potential spoofing
      if (!jwtOrg && trimmedHeader !== userWorkspace) {
        this.logger.warn(
          `[AUTH] SECURITY: X-Organization-Id header "${trimmedHeader}" provided without JWT org context. ` +
            `User ${userId} does not have active org session. Ignoring header.`,
        );
        // Fall through to workspace default
      }
    }

    // Use JWT org if available
    if (jwtOrg) {
      this.logger.log(`[AUTH] Using org from JWT payload: ${jwtOrg}`);
      return jwtOrg;
    }

    // Default to user's workspace
    this.logger.log(`[AUTH] No org found, using workspace: ${userWorkspace}`);
    return userWorkspace;
  }

  /**
   * Resolves user roles with priority:
   * 1. If user is in their own workspace (workspace-{userId}), they are ADMIN by default
   * 2. Otherwise, check Clerk JWT payload for org_role
   * 3. If JWT doesn't have org_role but user is in a Clerk org, check if org matches workspace pattern
   *    (this handles the case where JWT template doesn't include roles)
   */
  private resolveRoles(payload: ClerkJwt, organizationId: string, userId: string): AuthRole[] {
    const userWorkspace = `workspace-${userId}`;
    this.logger.log(
      `[AUTH] Resolving roles - Org: ${organizationId}, Workspace: ${userWorkspace}, JWT org_role: ${payload.org_role || 'none'}, JWT org_id: ${payload.o?.id || payload.org_id || 'none'}`,
    );

    // Check if user is in their own workspace
    if (organizationId === userWorkspace) {
      this.logger.log(`[AUTH] User is in their own workspace, granting ADMIN role`);
      return ['ADMIN'];
    }

    // Check Clerk organization role from JWT
    const clerkRole = payload.org_role?.toUpperCase();
    if (clerkRole === 'ADMIN' || clerkRole === 'ORG_ADMIN') {
      this.logger.log(`[AUTH] User has ADMIN role in Clerk organization`);
      return ['ADMIN'];
    }

    // If JWT doesn't have org_role, this likely means the JWT template isn't configured
    // to include organization roles. As a fallback, grant ADMIN access.
    // NOTE: In production, configure Clerk JWT template to include org_role for proper RBAC
    if (!payload.org_role) {
      this.logger.log(
        `[AUTH] JWT missing org_role field. Granting ADMIN as fallback (configure JWT template to include roles for proper RBAC)`,
      );
      return ['ADMIN'];
    }

    // If org_role exists but is not ADMIN, default to MEMBER
    this.logger.log(`[AUTH] Defaulting to MEMBER role`);
    return ['MEMBER'];
  }
}
