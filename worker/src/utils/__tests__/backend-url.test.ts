import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getBackendApiV1Url, getBackendOrigin } from '../backend-url';

const URL_ENV_KEYS = [
  'BACKEND_URL',
  'STUDIO_API_BASE_URL',
  'SHIPSEC_API_BASE_URL',
  'API_BASE_URL',
] as const;

type UrlEnvKey = (typeof URL_ENV_KEYS)[number];

let previousEnv: Partial<Record<UrlEnvKey, string | undefined>> = {};

function setOnly(values: Partial<Record<UrlEnvKey, string>>) {
  for (const key of URL_ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key as UrlEnvKey] = value;
  }
}

beforeEach(() => {
  previousEnv = {};
  for (const key of URL_ENV_KEYS) {
    previousEnv[key] = process.env[key];
  }
  for (const key of URL_ENV_KEYS) {
    Reflect.deleteProperty(process.env, key);
  }
});

afterEach(() => {
  for (const key of URL_ENV_KEYS) {
    const original = previousEnv[key];
    if (original === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = original;
    }
  }
});

describe('backend-url', () => {
  it('prefers BACKEND_URL and normalizes trailing slash', () => {
    setOnly({ BACKEND_URL: 'http://backend.internal:3211/' });

    expect(getBackendOrigin()).toBe('http://backend.internal:3211');
    expect(getBackendApiV1Url()).toBe('http://backend.internal:3211/api/v1');
  });

  it('strips /api/v1 suffix from BACKEND_URL if accidentally provided', () => {
    setOnly({ BACKEND_URL: 'http://backend.internal:3211/api/v1' });

    expect(getBackendOrigin()).toBe('http://backend.internal:3211');
    expect(getBackendApiV1Url()).toBe('http://backend.internal:3211/api/v1');
  });

  it('falls back to STUDIO_API_BASE_URL when BACKEND_URL is absent', () => {
    setOnly({ STUDIO_API_BASE_URL: 'http://legacy-host:3211/api/v1' });

    expect(getBackendOrigin()).toBe('http://legacy-host:3211');
  });

  it('falls back to localhost when no env vars are set', () => {
    setOnly({});

    expect(getBackendOrigin()).toBe('http://localhost:3211');
    expect(getBackendApiV1Url()).toBe('http://localhost:3211/api/v1');
  });
});
