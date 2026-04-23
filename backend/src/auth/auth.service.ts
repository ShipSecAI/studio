import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { AuthConfig } from '../config/auth.config';
import type { AuthContext } from './types';
import type { AuthProviderStrategy } from './providers/auth-provider.interface';
import { LocalAuthProvider } from './providers/local-auth.provider';
import { loadCloudAuthProvider } from './cloud-auth-provider.loader';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly provider: AuthProviderStrategy;

  constructor(private readonly configService: ConfigService) {
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
    const cloudProvider = loadCloudAuthProvider();
    if (cloudProvider) {
      return cloudProvider;
    }

    if (!config) {
      this.logger.warn('Auth config missing, defaulting to local provider');
      return new LocalAuthProvider({
        adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
        adminPassword: process.env.ADMIN_PASSWORD ?? 'admin',
      });
    }

    return new LocalAuthProvider(config.local);
  }
}
