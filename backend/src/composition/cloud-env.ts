import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function getBackendEnvFilePaths(): string[] {
  const instance = process.env.SHIPSEC_INSTANCE?.trim();
  if (instance) {
    return [join(process.cwd(), '..', '.instances', `instance-${instance}`, 'backend.env')];
  }

  return ['.env', '../.env'];
}

function shouldUseFileFallback(): boolean {
  const explicit = process.env.SHIPSEC_ALLOW_FILE_ENV_FALLBACK?.trim().toLowerCase();
  if (explicit) {
    return explicit === 'true';
  }

  return !(
    process.env.NODE_ENV === 'production' || process.env.SHIPSEC_ENV?.trim() === 'production'
  );
}

function readEnvValueFromFile(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;

  const prefix = `${key}=`;
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.startsWith(prefix)) continue;

    let value = line.slice(prefix.length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trimEnd();
      }
    }

    return value || null;
  }

  return null;
}

export function getBackendCloudEnvValue(key: string): string | null {
  const direct = process.env[key]?.trim();
  if (direct) return direct;

  if (!shouldUseFileFallback()) {
    return null;
  }

  for (const filePath of getBackendEnvFilePaths()) {
    const value = readEnvValueFromFile(filePath, key);
    if (value) return value;
  }

  return null;
}

export function getBackendCloudModuleId(): string | null {
  return getBackendCloudEnvValue('SHIPSEC_CLOUD_BACKEND_MODULE');
}
