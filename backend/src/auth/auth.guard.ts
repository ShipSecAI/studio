import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import type { AuthContext } from './types';

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

        // Allow unauthenticated GitHub webhooks (signature is verified separately)
        if (request.path?.startsWith('/api/v1/webhooks/github')) {
          return true;
        }

        this.logger.log(
          `[AUTH] Guard activating for ${request.method} ${request.path} - Provider: ${this.authService.providerName}`
        );
        
        try {
          request.auth = await this.authService.authenticate(request);
          this.logger.log(
            `[AUTH] Guard result - User: ${request.auth.userId}, Org: ${request.auth.organizationId}, Roles: [${request.auth.roles.join(', ')}], Authenticated: ${request.auth.isAuthenticated}`
          );
        } catch (error) {
          this.logger.error(
            `[AUTH] Authentication failed for ${request.method} ${request.path}: ${error instanceof Error ? error.message : String(error)}`
          );
          throw error;
        }
        
        return true;
      }
}
