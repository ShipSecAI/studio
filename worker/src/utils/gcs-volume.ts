/**
 * IsolatedGcsVolume — GCS FUSE CSI volume replacement for IsolatedK8sVolume.
 *
 * Uses a GCS bucket mounted via the GCS FUSE CSI driver instead of ConfigMaps.
 * Same interface as IsolatedK8sVolume / IsolatedContainerVolume so components
 * can swap transparently via the createIsolatedVolume() factory.
 *
 * Advantages over ConfigMap-backed volumes:
 * - No 1 MiB size limit (handles large outputs like Prowler)
 * - Native read-write (no log-based writeback hack)
 * - ReadWriteMany (parallel pods can share data)
 * - Worker reads output directly from GCS via SDK
 */
import { Storage } from '@google-cloud/storage';
import { ValidationError, ConfigurationError, ContainerError } from '@shipsec/component-sdk';

let _storage: Storage | null = null;

function getStorage(): Storage {
  if (!_storage) {
    // Auto-discovers Workload Identity credentials in GKE
    _storage = new Storage();
  }
  return _storage;
}

function getBucketName(): string {
  const bucket = process.env.GCS_VOLUME_BUCKET;
  if (!bucket) {
    throw new ConfigurationError('GCS_VOLUME_BUCKET environment variable is not set');
  }
  return bucket;
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 53);
}

export class IsolatedGcsVolume {
  private prefix?: string;
  private isInitialized = false;
  private bucketName: string;

  constructor(
    private tenantId: string,
    private runId: string,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new ValidationError(
        'Invalid tenant ID: must contain only alphanumeric characters, hyphens, and underscores',
        {
          fieldErrors: {
            tenantId: ['must contain only alphanumeric characters, hyphens, and underscores'],
          },
        },
      );
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new ValidationError(
        'Invalid run ID: must contain only alphanumeric characters, hyphens, and underscores',
        {
          fieldErrors: {
            runId: ['must contain only alphanumeric characters, hyphens, and underscores'],
          },
        },
      );
    }
    this.bucketName = getBucketName();
  }

  /**
   * Upload files to GCS under a unique prefix and return the prefix.
   * GCS key structure: {tenantId}/{runId}/{timestamp}/{filename}
   */
  async initialize(files: Record<string, string | Buffer>): Promise<string> {
    if (this.isInitialized) {
      throw new ConfigurationError('Volume already initialized', {
        details: { prefix: this.prefix, tenantId: this.tenantId, runId: this.runId },
      });
    }

    const timestamp = Date.now();
    const tenantShort = sanitizeName(this.tenantId);
    const runShort = sanitizeName(this.runId);
    this.prefix = `${tenantShort}/${runShort}/${timestamp}`;

    try {
      const storage = getStorage();
      const bucket = storage.bucket(this.bucketName);

      const uploads = Object.entries(files).map(async ([filename, content]) => {
        this.validateFilename(filename);
        const key = `${this.prefix}/${filename}`;
        const file = bucket.file(key);
        const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
        await file.save(data);
      });

      await Promise.all(uploads);

      this.isInitialized = true;
      return this.prefix;
    } catch (error) {
      if (this.prefix) {
        await this.cleanup().catch(() => {});
      }
      throw new ContainerError(
        `Failed to initialize GCS volume: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          details: { tenantId: this.tenantId, runId: this.runId },
        },
      );
    }
  }

  private validateFilename(filename: string): void {
    if (filename.includes('..') || filename.startsWith('/')) {
      throw new ValidationError(`Invalid filename (path traversal): ${filename}`, {
        fieldErrors: { filename: ['path traversal not allowed'] },
      });
    }
    const safePattern = /^[a-zA-Z0-9._/-]+$/;
    if (!safePattern.test(filename)) {
      throw new ValidationError(`Invalid filename (contains unsafe characters): ${filename}`, {
        fieldErrors: { filename: ['contains unsafe characters'] },
      });
    }
  }

  /**
   * Download files from GCS by name.
   */
  async readFiles(filenames: string[]): Promise<Record<string, string>> {
    if (!this.prefix) {
      throw new ConfigurationError('Volume not initialized');
    }

    const storage = getStorage();
    const bucket = storage.bucket(this.bucketName);
    const results: Record<string, string> = {};

    for (const filename of filenames) {
      try {
        const key = `${this.prefix}/${filename}`;
        const file = bucket.file(key);
        const [contents] = await file.download();
        results[filename] = contents.toString('utf-8');
      } catch (error) {
        console.warn(
          `Could not read file ${filename} from GCS: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  /**
   * Returns volume config for the runner.
   * The K8s runner recognizes the "gcsfuse:" prefix and creates a CSI volume.
   * Format: "gcsfuse:{bucketName}:{prefix}"
   */
  getVolumeConfig(containerPath = '/inputs', readOnly = true) {
    if (!this.prefix) {
      throw new ConfigurationError('Volume not initialized');
    }
    return {
      source: `gcsfuse:${this.bucketName}:${this.prefix}`,
      target: containerPath,
      readOnly,
    };
  }

  /**
   * Returns a bind mount string (for interface compatibility).
   */
  getBindMount(containerPath = '/inputs', readOnly = true): string {
    if (!this.prefix) {
      throw new ConfigurationError('Volume not initialized');
    }
    const mode = readOnly ? 'ro' : 'rw';
    return `gcsfuse:${this.bucketName}:${this.prefix}:${containerPath}:${mode}`;
  }

  /**
   * Delete all objects under the GCS prefix.
   */
  async cleanup(): Promise<void> {
    if (!this.prefix) return;

    try {
      const storage = getStorage();
      const bucket = storage.bucket(this.bucketName);
      await bucket.deleteFiles({ prefix: `${this.prefix}/` });
    } catch (error) {
      console.error(
        `Failed to cleanup GCS volume ${this.prefix}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isInitialized = false;
      this.prefix = undefined;
    }
  }

  getVolumeName(): string | undefined {
    return this.prefix;
  }
}
