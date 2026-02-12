import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

const INTERNAL_ONLY_KEY = 'internal_only';

/**
 * NestJS guard that restricts access to internal service calls only.
 *
 * Authentication is via the `X-Internal-Token` header matched against
 * the `INTERNAL_SERVICE_TOKEN` environment variable.
 *
 * If `INTERNAL_SERVICE_TOKEN` is NOT set:
 *   - If `ALLOW_INSECURE_INTERNAL_ENDPOINTS=true` → allow with warning
 *   - Otherwise → reject with 403
 *
 * Note: Internal endpoints have no per-org scoping. Workers authenticate
 * via a shared service secret, not per-user/per-org credentials. Tenant
 * isolation is enforced at the workflow layer (workflows are org-scoped).
 */
@Injectable()
export class InternalOnlyGuard implements CanActivate {
  private readonly logger = new Logger(InternalOnlyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isInternalOnly = this.reflector.getAllAndOverride<boolean>(INTERNAL_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isInternalOnly) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedToken = request.header('x-internal-token');
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN;

    if (!expectedToken) {
      if (process.env.ALLOW_INSECURE_INTERNAL_ENDPOINTS === 'true') {
        this.logger.warn(
          `INTERNAL_SERVICE_TOKEN is not set. Allowing insecure access to ${request.method} ${request.path} because ALLOW_INSECURE_INTERNAL_ENDPOINTS=true.`,
        );
        return true;
      }

      throw new ForbiddenException(
        'INTERNAL_SERVICE_TOKEN must be configured or ALLOW_INSECURE_INTERNAL_ENDPOINTS=true must be set',
      );
    }

    if (providedToken !== expectedToken) {
      throw new ForbiddenException('Invalid internal access token');
    }

    return true;
  }
}

/**
 * Decorator that restricts an endpoint to internal service calls only.
 * Validates the `X-Internal-Token` header against `INTERNAL_SERVICE_TOKEN`.
 */
export function InternalOnly(): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(INTERNAL_ONLY_KEY, true), UseGuards(InternalOnlyGuard));
}
