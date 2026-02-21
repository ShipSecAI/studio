import { describe, expect, it } from 'bun:test';

import { redactSensitiveData } from '../redact-sensitive';

describe('redactSensitiveData', () => {
  it('redacts common secret key-value pairs', () => {
    const input =
      'authorization=Bearer abcdefghijklmnop token=123456 password=hunter2 api_key=xyz987';
    const redacted = redactSensitiveData(input);

    expect(redacted).toContain('authorization=[REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).toContain('api_key=[REDACTED]');
  });

  it('redacts JSON-style secret fields', () => {
    const input = '{"access_token":"abc123","client_secret":"super-secret"}';
    const redacted = redactSensitiveData(input);

    expect(redacted).toBe('{"access_token":"[REDACTED]","client_secret":"[REDACTED]"}');
  });

  it('redacts token-like standalone values and URL params', () => {
    const input =
      'https://example.com?token=abc123&foo=1 Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aGVsbG8td29ybGQ.signature ghp_abcdefghijklmnopqrstuvwxyz1234 sk-abcdefghijklmnopqrstuvwxyz123456';
    const redacted = redactSensitiveData(input);

    expect(redacted).toContain('?token=[REDACTED]&foo=1');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1Ni');
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234');
    expect(redacted).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('redacts github clone URLs with embedded x-access-token credentials', () => {
    const input =
      'CLONE_URL=https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz1234567890@github.com/LuD1161/git-test-repo.git';
    const redacted = redactSensitiveData(input);

    expect(redacted).toContain('CLONE_URL=https://x-access-token:[REDACTED]@github.com/');
    expect(redacted).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('preserves non-sensitive text', () => {
    const input = 'workflow finished successfully in 245ms';
    expect(redactSensitiveData(input)).toBe(input);
  });
});
