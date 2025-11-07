import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AuthConfig, AuthProvider as AuthProviderName } from '../config/auth.config';
import type { AuthContext } from './types';
import type { AuthProviderStrategy } from './providers/auth-provider.interface';
import { LocalAuthProvider } from './providers/local-auth.provider';
import { ClerkAuthProvider } from './providers/clerk-auth.provider';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly provider: AuthProviderStrategy;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.provider = this.createProvider();
    this.logger.log(`Auth provider initialised: ${this.provider.name}`);
  }

  async authenticate(request: Request): Promise<AuthContext> {
    return this.provider.authenticate(request);
  }

  get providerName(): string {
    return this.provider.name;
  }

  private createProvider(): AuthProviderStrategy {
    const config = this.configService.get<AuthConfig>('auth');
    if (!config) {
      this.logger.warn('Auth config missing, defaulting to local provider');
      return new LocalAuthProvider({
        adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
        adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
      });
    }

    const provider: AuthProviderName = config.provider;
    if (provider === 'clerk') {
      // Validate Clerk configuration before creating provider
      if (!config.clerk.secretKey) {
        const error = new Error(
          'Clerk auth provider is configured but CLERK_SECRET_KEY is missing. ' +
          'Please set CLERK_SECRET_KEY in your environment variables or change AUTH_PROVIDER to "local".'
        );
        this.logger.error(error.message);
        throw error;
      }
      if (!config.clerk.publishableKey) {
        this.logger.warn('CLERK_PUBLISHABLE_KEY is not set, but this is only needed on the frontend');
      }
      return new ClerkAuthProvider(config.clerk);
    }

    return new LocalAuthProvider(config.local);
  }
}
