import { afterEach, describe, expect, it } from 'bun:test';
import { getVersionCheckBaseUrl, isVersionCheckDisabled } from '../version-check';

const ORIGINAL_ENV = { ...process.env };

describe('versionCheck', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('treats the version check as disabled when no URL is configured', () => {
    delete process.env.SHIPSEC_VERSION_CHECK_URL;
    delete process.env.SHIPSEC_VERSION_CHECK_DISABLED;

    expect(getVersionCheckBaseUrl()).toBeNull();
    expect(isVersionCheckDisabled()).toBe(true);
  });

  it('uses the configured version-check URL when present', () => {
    process.env.SHIPSEC_VERSION_CHECK_URL = 'https://updates.example.com';
    delete process.env.SHIPSEC_VERSION_CHECK_DISABLED;

    expect(getVersionCheckBaseUrl()).toBe('https://updates.example.com');
    expect(isVersionCheckDisabled()).toBe(false);
  });

  it('still honors the explicit disable flag', () => {
    process.env.SHIPSEC_VERSION_CHECK_URL = 'https://updates.example.com';
    process.env.SHIPSEC_VERSION_CHECK_DISABLED = 'true';

    expect(isVersionCheckDisabled()).toBe(true);
  });
});
