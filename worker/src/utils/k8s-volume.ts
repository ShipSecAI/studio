/**
 * IsolatedK8sVolume — K8s-native replacement for IsolatedContainerVolume.
 *
 * Uses ConfigMaps instead of Docker named volumes. Same interface as
 * IsolatedContainerVolume so components can swap transparently.
 *
 * Limits:
 * - ConfigMap total size: 1 MiB (sufficient for target lists, configs, templates)
 * - For binary data or large payloads, consider using a PVC-based approach
 */
import * as k8s from '@kubernetes/client-node';
import { ValidationError, ConfigurationError, ContainerError } from '@shipsec/component-sdk';

let _kc: k8s.KubeConfig | null = null;
let _coreApi: k8s.CoreV1Api | null = null;

function getKubeConfig(): k8s.KubeConfig {
  if (!_kc) {
    _kc = new k8s.KubeConfig();
    _kc.loadFromCluster();
  }
  return _kc;
}

function getCoreApi(): k8s.CoreV1Api {
  if (!_coreApi) _coreApi = getKubeConfig().makeApiClient(k8s.CoreV1Api);
  return _coreApi;
}

function getNamespace(): string {
  return process.env.K8S_JOB_NAMESPACE || 'shipsec-workloads';
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 53);
}

export class IsolatedK8sVolume {
  private configMapName?: string;
  private isInitialized = false;
  private namespace: string;

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
    this.namespace = getNamespace();
  }

  /**
   * Creates a ConfigMap containing the provided files.
   * Text files go in `data`, binary files go in `binaryData`.
   */
  async initialize(files: Record<string, string | Buffer>): Promise<string> {
    if (this.isInitialized) {
      throw new ConfigurationError('Volume already initialized', {
        details: { configMapName: this.configMapName, tenantId: this.tenantId, runId: this.runId },
      });
    }

    const timestamp = Date.now();
    const tenantShort = sanitizeName(this.tenantId);
    const runShort = sanitizeName(this.runId);
    this.configMapName = `vol-${tenantShort}-${runShort}-${timestamp}`.slice(0, 63);

    try {
      const data: Record<string, string> = {};
      const binaryData: Record<string, string> = {};

      for (const [filename, content] of Object.entries(files)) {
        this.validateFilename(filename);

        // ConfigMap keys can't have slashes — flatten paths
        const key = filename.replace(/\//g, '__');

        if (typeof content === 'string') {
          data[key] = content;
        } else {
          // Buffer → base64 for binaryData
          binaryData[key] = content.toString('base64');
        }
      }

      const body: k8s.V1ConfigMap = {
        metadata: {
          name: this.configMapName,
          namespace: this.namespace,
          labels: {
            'app.kubernetes.io/managed-by': 'shipsec-worker',
            'shipsec.ai/purpose': 'isolated-volume',
            'shipsec.ai/tenant': tenantShort,
            'shipsec.ai/run': runShort,
          },
        },
        data: Object.keys(data).length > 0 ? data : undefined,
        binaryData: Object.keys(binaryData).length > 0 ? binaryData : undefined,
      };

      await getCoreApi().createNamespacedConfigMap({
        namespace: this.namespace,
        body,
      });

      this.isInitialized = true;
      return this.configMapName;
    } catch (error) {
      if (this.configMapName) {
        await this.cleanup().catch(() => {});
      }
      throw new ContainerError(
        `Failed to initialize K8s volume: ${error instanceof Error ? error.message : String(error)}`,
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
   * Read files from the ConfigMap.
   */
  async readFiles(filenames: string[]): Promise<Record<string, string>> {
    if (!this.configMapName) {
      throw new ConfigurationError('Volume not initialized');
    }

    const cm = await getCoreApi().readNamespacedConfigMap({
      name: this.configMapName,
      namespace: this.namespace,
    });

    const results: Record<string, string> = {};
    for (const filename of filenames) {
      const key = filename.replace(/\//g, '__');
      if (cm.data?.[key]) {
        results[filename] = cm.data[key];
      } else if (cm.binaryData?.[key]) {
        results[filename] = Buffer.from(cm.binaryData[key], 'base64').toString('utf-8');
      }
    }
    return results;
  }

  /**
   * Returns a bind mount string compatible with the K8s runner.
   * Format: "configmap:<name>:<path>:<mode>"
   */
  getBindMount(containerPath = '/inputs', readOnly = true): string {
    if (!this.configMapName) {
      throw new ConfigurationError('Volume not initialized');
    }
    const mode = readOnly ? 'ro' : 'rw';
    return `configmap:${this.configMapName}:${containerPath}:${mode}`;
  }

  /**
   * Returns volume config for the runner. The K8s runner recognizes the
   * "configmap:" prefix in source and mounts the ConfigMap accordingly.
   */
  getVolumeConfig(containerPath = '/inputs', readOnly = true) {
    if (!this.configMapName) {
      throw new ConfigurationError('Volume not initialized');
    }
    return {
      source: `configmap:${this.configMapName}`,
      target: containerPath,
      readOnly,
    };
  }

  /**
   * Delete the ConfigMap.
   */
  async cleanup(): Promise<void> {
    if (!this.configMapName) return;

    try {
      await getCoreApi().deleteNamespacedConfigMap({
        name: this.configMapName,
        namespace: this.namespace,
      });
    } catch (error) {
      console.error(
        `Failed to cleanup K8s volume ${this.configMapName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isInitialized = false;
      this.configMapName = undefined;
    }
  }

  getVolumeName(): string | undefined {
    return this.configMapName;
  }
}
