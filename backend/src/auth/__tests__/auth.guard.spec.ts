import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthGuard, type RequestWithAuthContext } from '../auth.guard';
import { AuthService } from '../auth.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import type { AuthContext } from '../types';
import type { ApiKey } from '../../database/schema/api-keys';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockAuthService: {
    authenticate: ReturnType<typeof vi.fn>;
    providerName: string;
  };
  let mockApiKeysService: {
    validateKey: ReturnType<typeof vi.fn>;
  };
  let mockExecutionContext: ExecutionContext;
  let mockRequest: RequestWithAuthContext;

  beforeEach(() => {
    // Reset mocks
    mockAuthService = {
      authenticate: vi.fn(),
      providerName: 'clerk',
    };
    mockApiKeysService = {
      validateKey: vi.fn(),
    };

    // Create guard with mocked dependencies
    guard = new AuthGuard(
      mockAuthService as unknown as AuthService,
      mockApiKeysService as unknown as ApiKeysService,
    );

    // Setup mock request
    mockRequest = {
      method: 'GET',
      path: '/api/v1/test',
      header: vi.fn() as unknown as Request['header'],
      headers: {},
    } as unknown as RequestWithAuthContext;

    // Setup mock execution context
    mockExecutionContext = {
      switchToHttp: vi.fn(() => ({
        getRequest: vi.fn(() => mockRequest),
      })),
    } as unknown as ExecutionContext;
  });

  describe('canActivate - authentication priority', () => {
    it('should allow requests without auth context (no request)', async () => {
      const contextWithoutRequest = {
        switchToHttp: vi.fn(() => ({
          getRequest: vi.fn(() => null),
        })),
      } as unknown as ExecutionContext;

      const result = await guard.canActivate(contextWithoutRequest);
      expect(result).toBe(true);
    });

    it('should prioritize internal auth over API key auth', async () => {
      const internalToken = 'internal-secret-token';
      process.env.INTERNAL_SERVICE_TOKEN = internalToken;

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return internalToken;
        if (name === 'x-organization-id') return 'org-123';
        return undefined;
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth).toMatchObject({
        userId: 'internal-service',
        organizationId: 'org-123',
        provider: 'internal',
        isAuthenticated: true,
      });
      expect(mockApiKeysService.validateKey).not.toHaveBeenCalled();
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();

      delete process.env.INTERNAL_SERVICE_TOKEN;
    });

    it('should prioritize API key auth over user auth', async () => {
      const apiKey = 'sk_live_abc12345_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-123',
        organizationId: 'org-456',
        name: 'Test Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'abc12345',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed-key',
        createdBy: 'user-1',
        rateLimit: null,
        scopes: null,
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth).toMatchObject({
        userId: 'key-123',
        organizationId: 'org-456',
        roles: ['MEMBER'],
        provider: 'api-key',
        isAuthenticated: true,
      });
      expect(mockApiKeysService.validateKey).toHaveBeenCalledWith(apiKey);
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();
    });

    it('should fall back to user auth when no internal or API key auth', async () => {
      const mockUserAuth: AuthContext = {
        userId: 'user-789',
        organizationId: 'org-999',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'clerk',
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      mockAuthService.authenticate.mockResolvedValue(mockUserAuth);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth).toEqual(mockUserAuth);
      expect(mockApiKeysService.validateKey).not.toHaveBeenCalled();
      expect(mockAuthService.authenticate).toHaveBeenCalledWith(mockRequest);
    });
  });

  describe('tryInternalAuth', () => {
    beforeEach(() => {
      process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
    });

    afterEach(() => {
      delete process.env.INTERNAL_SERVICE_TOKEN;
    });

    it('should authenticate with valid internal token', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return 'test-internal-token';
        if (name === 'x-organization-id') return 'org-internal';
        return undefined;
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('internal');
      expect(mockRequest.auth?.organizationId).toBe('org-internal');
    });

    it('should use default organization when x-organization-id not provided', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return 'test-internal-token';
        return undefined;
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('internal');
      expect(mockRequest.auth?.organizationId).toBeDefined();
    });

    it('should reject invalid internal token', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return 'wrong-token';
        return undefined;
      });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return null when internal token not provided', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);

      // Should fall through to API key or user auth
      mockAuthService.authenticate.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'clerk',
      });

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('clerk');
    });

    it('should check x-org-id header as fallback', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return 'test-internal-token';
        if (name === 'x-org-id') return 'org-from-x-org-id';
        return undefined;
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.organizationId).toBe('org-from-x-org-id');
    });
  });

  describe('tryApiKeyAuth', () => {
    it('should authenticate with valid API key', async () => {
      const apiKey = 'sk_live_test123_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-valid',
        organizationId: 'org-api-key',
        name: 'Valid Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'test123',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: true },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed',
        createdBy: 'user-1',
        rateLimit: 1000,
        scopes: null,
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth).toMatchObject({
        userId: 'key-valid',
        organizationId: 'org-api-key',
        roles: ['MEMBER'],
        provider: 'api-key',
        isAuthenticated: true,
      });
      expect(mockApiKeysService.validateKey).toHaveBeenCalledWith(apiKey);
    });

    it('should return null when Authorization header missing', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);

      mockAuthService.authenticate.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'clerk',
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockApiKeysService.validateKey).not.toHaveBeenCalled();
      expect(mockRequest.auth?.provider).toBe('clerk');
    });

    it('should return null when Authorization header does not start with Bearer sk_', async () => {
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return 'Bearer pk_test_123';
        return undefined;
      });

      mockAuthService.authenticate.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'clerk',
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockApiKeysService.validateKey).not.toHaveBeenCalled();
      expect(mockRequest.auth?.provider).toBe('clerk');
    });

    it('should return null when API key validation fails', async () => {
      const apiKey = 'sk_live_invalid_secretkey12345678901234567890';

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(null);

      mockAuthService.authenticate.mockResolvedValue({
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'clerk',
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockApiKeysService.validateKey).toHaveBeenCalledWith(apiKey);
      expect(mockRequest.auth?.provider).toBe('clerk');
    });

    it('should extract API key token correctly from Bearer header', async () => {
      const apiKey = 'sk_live_test123_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-extract',
        organizationId: 'org-extract',
        name: 'Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'test123',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed',
        createdBy: 'user-1',
        rateLimit: null,
        scopes: null,
      };

      // The guard checks for "Bearer sk_" format and extracts token with replace(/^Bearer\s+/, '')
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      // The guard strips "Bearer " prefix, so validateKey should receive just the apiKey
      expect(mockApiKeysService.validateKey).toHaveBeenCalledWith(apiKey);
      expect(mockRequest.auth?.provider).toBe('api-key');
      expect(mockRequest.auth?.organizationId).toBe('org-extract');
    });
  });

  describe('user authentication fallback', () => {
    it('should call authService.authenticate when no internal or API key auth', async () => {
      const mockUserAuth: AuthContext = {
        userId: 'clerk-user-123',
        organizationId: 'clerk-org-456',
        roles: ['ADMIN', 'MEMBER'],
        isAuthenticated: true,
        provider: 'clerk',
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      mockAuthService.authenticate.mockResolvedValue(mockUserAuth);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth).toEqual(mockUserAuth);
      expect(mockAuthService.authenticate).toHaveBeenCalledWith(mockRequest);
    });

    it('should propagate authentication errors from authService', async () => {
      const authError = new UnauthorizedException('Invalid Clerk token');

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      mockAuthService.authenticate.mockRejectedValue(authError);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRequest.auth).toBeUndefined();
    });

    it('should handle different auth providers', async () => {
      mockAuthService.providerName = 'local';

      const mockLocalAuth: AuthContext = {
        userId: 'local-user',
        organizationId: 'local-org',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'local',
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      mockAuthService.authenticate.mockResolvedValue(mockLocalAuth);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('local');
    });
  });

  describe('edge cases', () => {
    it('should handle request with all auth methods present (internal wins)', async () => {
      process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';

      const apiKey = 'sk_live_test123_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-1',
        organizationId: 'org-1',
        name: 'Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'test123',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed',
        createdBy: 'user-1',
        rateLimit: null,
        scopes: null,
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'x-internal-token') return 'internal-token';
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('internal');
      expect(mockApiKeysService.validateKey).not.toHaveBeenCalled();
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();

      delete process.env.INTERNAL_SERVICE_TOKEN;
    });

    it('should handle request with API key and user auth (API key wins)', async () => {
      const apiKey = 'sk_live_test123_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-1',
        organizationId: 'org-api',
        name: 'Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'test123',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed',
        createdBy: 'user-1',
        rateLimit: null,
        scopes: null,
      };

      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('api-key');
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();
    });

    it('should handle case-insensitive Authorization header', async () => {
      const apiKey = 'sk_live_test123_secretkey12345678901234567890';
      const mockApiKeyRecord: ApiKey = {
        id: 'key-1',
        organizationId: 'org-1',
        name: 'Key',
        description: null,
        keyPrefix: 'sk_live_',
        keyHint: 'test123',
        permissions: {
          workflows: { run: true, list: true, read: true },
          runs: { read: true, cancel: false },
        },
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        keyHash: 'hashed',
        createdBy: 'user-1',
        rateLimit: null,
        scopes: null,
      };

      // Express header() method is case-insensitive, but we'll test the actual behavior
      (mockRequest.header as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name.toLowerCase() === 'authorization') return `Bearer ${apiKey}`;
        return undefined;
      });

      mockApiKeysService.validateKey.mockResolvedValue(mockApiKeyRecord);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockRequest.auth?.provider).toBe('api-key');
    });
  });
});

