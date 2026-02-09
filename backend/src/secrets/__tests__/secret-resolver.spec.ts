import { describe, it, expect, beforeEach } from 'bun:test';
import { SecretResolver } from '../secret-resolver';
import type { SecretsService } from '../secrets.service';
import type { AuthContext } from '../../auth/types';

// Mock SecretsService
class MockSecretsService {
  private secrets = new Map<string, { value: string }>();

  setSecret(id: string, value: string) {
    this.secrets.set(id, { value });
  }

  async getSecretValue(_auth: AuthContext | null, secretId: string) {
    const secret = this.secrets.get(secretId);
    if (!secret) {
      throw new Error(`Secret ${secretId} not found`);
    }
    return secret;
  }
}

describe('SecretResolver', () => {
  let resolver: SecretResolver;
  let mockSecretsService: MockSecretsService;
  const auth: AuthContext = {
    userId: 'test-user',
    organizationId: 'test-org',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'local',
  };

  // Use valid UUID-like IDs for testing
  const SECRET_1 = 'a1b2c3d4e5f67890abcdef1234567890';
  const SECRET_2 = 'b2c3d4e5f6a7b8c9def0123456789012';
  const API_KEY = 'c3d4e5f6a7b8c9d0ef12345678901234';

  beforeEach(() => {
    mockSecretsService = new MockSecretsService();
    resolver = new SecretResolver(mockSecretsService as unknown as SecretsService);

    // Set up test secrets
    mockSecretsService.setSecret(SECRET_1, 'value-one');
    mockSecretsService.setSecret(SECRET_2, 'value-two');
    mockSecretsService.setSecret(API_KEY, 'sk-test-12345');
  });

  describe('resolveString', () => {
    it('returns original string when no secret references exist', async () => {
      const input = 'Hello, World!';
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('Hello, World!');
    });

    it('replaces single secret reference', async () => {
      const input = `Bearer {{secret:${SECRET_1}}}`;
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('Bearer value-one');
    });

    it('replaces multiple secret references in one string', async () => {
      const input = `{{secret:${SECRET_1}}} and {{secret:${SECRET_2}}}`;
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('value-one and value-two');
    });

    it('replaces duplicate secret references efficiently', async () => {
      const input = `{{secret:${SECRET_1}}}-{{secret:${SECRET_1}}}-{{secret:${SECRET_1}}}`;
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('value-one-value-one-value-one');
    });

    it('replaces secret reference in JSON-like string', async () => {
      const input = `{"apiKey": "{{secret:${API_KEY}}}", "version": "1.0"}`;
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('{"apiKey": "sk-test-12345", "version": "1.0"}');
    });

    it('handles malformed secret reference gracefully', async () => {
      const input = 'This is {{malformed}}';
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('This is {{malformed}}');
    });

    it('replaces with empty string when secret not found', async () => {
      const input = 'Bearer {{secret:00000000000000000000000000000000}}';
      const result = await resolver.resolveString(input, { auth });
      expect(result).toBe('Bearer ');
    });
  });

  describe('resolveRecord', () => {
    it('returns empty record for empty input', async () => {
      const result = await resolver.resolveRecord({}, { auth });
      expect(result).toEqual({});
    });

    it('resolves secrets in header values', async () => {
      const input = {
        Authorization: `Bearer {{secret:${SECRET_1}}}`,
        'X-API-Key': `{{secret:${API_KEY}}}`,
      };
      const result = await resolver.resolveRecord(input, { auth });
      expect(result).toEqual({
        Authorization: 'Bearer value-one',
        'X-API-Key': 'sk-test-12345',
      });
    });

    it('keeps non-secret values intact', async () => {
      const input = {
        'Content-Type': 'application/json',
        Authorization: `Bearer {{secret:${SECRET_1}}}`,
      };
      const result = await resolver.resolveRecord(input, { auth });
      expect(result).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer value-one',
      });
    });
  });

  describe('resolveArray', () => {
    it('returns empty array for empty input', async () => {
      const result = await resolver.resolveArray([], { auth });
      expect(result).toEqual([]);
    });

    it('resolves secrets in array elements', async () => {
      const input = ['--token', `{{secret:${API_KEY}}}`, '--url', 'https://api.example.com'];
      const result = await resolver.resolveArray(input, { auth });
      expect(result).toEqual(['--token', 'sk-test-12345', '--url', 'https://api.example.com']);
    });

    it('handles mixed secret and non-secret values', async () => {
      const input = [
        `--api-key={{secret:${API_KEY}}}`,
        `--secret={{secret:${SECRET_1}}}`,
        '--debug=true',
      ];
      const result = await resolver.resolveArray(input, { auth });
      expect(result).toEqual(['--api-key=sk-test-12345', '--secret=value-one', '--debug=true']);
    });
  });

  describe('resolveMcpConfig', () => {
    it('returns empty object for null inputs', async () => {
      const result = await resolver.resolveMcpConfig(null, null, { auth });
      expect(result).toEqual({});
    });

    it('resolves secrets in headers', async () => {
      const headers = {
        Authorization: `Bearer {{secret:${SECRET_1}}}`,
        'X-API-Key': `{{secret:${API_KEY}}}`,
      };
      const result = await resolver.resolveMcpConfig(headers, null, { auth });
      expect(result).toEqual({
        headers: {
          Authorization: 'Bearer value-one',
          'X-API-Key': 'sk-test-12345',
        },
      });
    });

    it('resolves secrets in args array', async () => {
      const args = ['--token', `{{secret:${API_KEY}}}`, '--secret', `{{secret:${SECRET_2}}}`];
      const result = await resolver.resolveMcpConfig(null, args, { auth });
      expect(result).toEqual({
        args: ['--token', 'sk-test-12345', '--secret', 'value-two'],
      });
    });

    it('resolves secrets in both headers and args', async () => {
      const headers = {
        Authorization: `Bearer {{secret:${SECRET_1}}}`,
      };
      const args = ['--token', `{{secret:${API_KEY}}}`];
      const result = await resolver.resolveMcpConfig(headers, args, { auth });
      expect(result).toEqual({
        headers: {
          Authorization: 'Bearer value-one',
        },
        args: ['--token', 'sk-test-12345'],
      });
    });

    it('handles undefined headers', async () => {
      const args = ['--token', `{{secret:${API_KEY}}}`];
      const result = await resolver.resolveMcpConfig(undefined, args, { auth });
      expect(result).toEqual({
        args: ['--token', 'sk-test-12345'],
      });
    });

    it('handles undefined args', async () => {
      const headers = {
        Authorization: `Bearer {{secret:${SECRET_1}}}`,
      };
      const result = await resolver.resolveMcpConfig(headers, undefined, { auth });
      expect(result).toEqual({
        headers: {
          Authorization: 'Bearer value-one',
        },
      });
    });
  });
});
