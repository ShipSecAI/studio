/**
 * K8s Job Runner — executes component containers as Kubernetes Jobs
 * instead of shelling out to `docker run`.
 *
 * Replaces DIND entirely. The worker pod needs a ServiceAccount with
 * RBAC to create Jobs, ConfigMaps, and read pod logs in the target namespace.
 */
import * as k8s from '@kubernetes/client-node';
import type { DockerRunnerConfig, ExecutionContext } from '@shipsec/component-sdk';
import {
  ConfigurationError,
  ContainerError,
  TimeoutError,
  ValidationError,
} from '@shipsec/component-sdk';
import { createIsolatedVolume, type IsolatedVolume } from './isolated-volume';

const CONTAINER_OUTPUT_PATH = '/shipsec-output';
const OUTPUT_FILENAME = 'result.json';

interface BuildJobResult {
  job: k8s.V1Job;
  hasGcsFuse: boolean;
}

interface OutputVolumeConfig {
  source: string;
  target: string;
  readOnly: boolean;
}

const DEFAULT_GCSFUSE_WRITABLE_UID = process.env.K8S_GCSFUSE_WRITABLE_UID || '65532';
const DEFAULT_GCSFUSE_WRITABLE_GID = process.env.K8S_GCSFUSE_WRITABLE_GID || '65532';
const DEFAULT_GCSFUSE_WRITABLE_FILE_MODE = process.env.K8S_GCSFUSE_WRITABLE_FILE_MODE || '0666';
const DEFAULT_GCSFUSE_WRITABLE_DIR_MODE = process.env.K8S_GCSFUSE_WRITABLE_DIR_MODE || '0777';

// Lazy-init shared K8s clients
let _kc: k8s.KubeConfig | null = null;
let _batchApi: k8s.BatchV1Api | null = null;
let _coreApi: k8s.CoreV1Api | null = null;

function getKubeConfig(): k8s.KubeConfig {
  if (!_kc) {
    _kc = new k8s.KubeConfig();
    _kc.loadFromCluster(); // uses in-cluster SA token
  }
  return _kc;
}

function getBatchApi(): k8s.BatchV1Api {
  if (!_batchApi) _batchApi = getKubeConfig().makeApiClient(k8s.BatchV1Api);
  return _batchApi;
}

function getCoreApi(): k8s.CoreV1Api {
  if (!_coreApi) _coreApi = getKubeConfig().makeApiClient(k8s.CoreV1Api);
  return _coreApi;
}

function getJobNamespace(): string {
  return process.env.K8S_JOB_NAMESPACE || 'shipsec-workloads';
}

function parseJsonEnv<T>(envName: string, context: ExecutionContext): T | undefined {
  const raw = process.env[envName];
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    context.logger.warn(
      `[K8sRunner] Invalid JSON in ${envName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function getJobNodeSelector(context: ExecutionContext): Record<string, string> | undefined {
  const parsed = parseJsonEnv<Record<string, unknown>>('K8S_JOB_NODE_SELECTOR_JSON', context);
  if (!parsed || Array.isArray(parsed)) return undefined;

  const selector: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.trim().length === 0) continue;
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    selector[key] = value;
  }

  return Object.keys(selector).length > 0 ? selector : undefined;
}

function getJobTolerations(context: ExecutionContext): k8s.V1Toleration[] | undefined {
  const parsed = parseJsonEnv<unknown[]>('K8S_JOB_TOLERATIONS_JSON', context);
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed as k8s.V1Toleration[];
}

function getJobPodSecurityContext(context: ExecutionContext): k8s.V1PodSecurityContext {
  const parsed = parseJsonEnv<k8s.V1PodSecurityContext>(
    'K8S_JOB_POD_SECURITY_CONTEXT_JSON',
    context,
  );
  return parsed ?? { seccompProfile: { type: 'RuntimeDefault' } };
}

function getJobContainerSecurityContext(context: ExecutionContext): k8s.V1SecurityContext {
  const parsed = parseJsonEnv<k8s.V1SecurityContext>(
    'K8S_JOB_CONTAINER_SECURITY_CONTEXT_JSON',
    context,
  );
  return parsed ?? { allowPrivilegeEscalation: false, readOnlyRootFilesystem: false };
}

function sanitizeName(raw: string): string {
  // K8s names: lowercase, alphanumeric + hyphens, max 63 chars
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 53); // leave room for random suffix
}

function generateJobName(context: ExecutionContext, image: string): string {
  const imgShort = sanitizeName(image.split('/').pop()?.split(':')[0] || 'job');
  const runShort = sanitizeName(context.runId).slice(0, 8);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ss-${imgShort}-${runShort}-${rand}`;
}

export function buildGcsFuseMountOptions(onlyDir: string, readOnly: boolean): string {
  const options = ['implicit-dirs', `only-dir=${onlyDir}`];

  if (!readOnly) {
    options.push(
      `uid=${DEFAULT_GCSFUSE_WRITABLE_UID}`,
      `gid=${DEFAULT_GCSFUSE_WRITABLE_GID}`,
      `file-mode=${DEFAULT_GCSFUSE_WRITABLE_FILE_MODE}`,
      `dir-mode=${DEFAULT_GCSFUSE_WRITABLE_DIR_MODE}`,
    );
  }

  return options.join(',');
}

/**
 * Resolve the command/args K8s should execute.
 *
 * For exact `binary "$@"` shell wrappers we strip the shell so distroless
 * images continue to work on K8s without depending on `/bin/sh`.
 */
export function resolveK8sCommand(runner: DockerRunnerConfig): {
  command: string[];
  args: string[];
} {
  const { entrypoint, command } = runner;

  const isShellEntrypoint =
    entrypoint === 'sh' ||
    entrypoint === 'bash' ||
    entrypoint === '/bin/sh' ||
    entrypoint === '/bin/bash';

  if (isShellEntrypoint && command.length >= 2 && command[0] === '-c') {
    // Shell wrapper pattern: entrypoint=sh, command=['-c', 'binary "$@"', '--', ...dynamicArgs]
    const shellScript = command[1];
    const dynamicArgsMatch = shellScript.match(/^(\S+)\s+"\$@"$/);
    const dashDashIdx = command.indexOf('--');
    const dynamicArgs = dashDashIdx >= 0 ? command.slice(dashDashIdx + 1) : [];
    const usesDynamicArgs = dashDashIdx >= 0 && /\$@/.test(shellScript);

    if (dynamicArgsMatch) {
      // Dynamic args pattern for distroless images (e.g., 'subfinder "$@"')
      // These images don't have sh — use their default ENTRYPOINT directly.
      // The dynamic args follow after '--' in the command array.
      // Return empty command to use image's ENTRYPOINT, pass dynamic args directly
      return { command: [], args: dynamicArgs };
    }

    if (usesDynamicArgs) {
      return { command: [entrypoint!], args: ['-c', shellScript, '--', ...dynamicArgs] };
    }
    return { command: [entrypoint!], args: ['-c', shellScript] };
  }

  if (isShellEntrypoint) {
    return { command: [entrypoint!], args: command };
  }

  if (entrypoint) {
    return { command: [entrypoint], args: command };
  }

  if (command.length > 0) {
    // No entrypoint set → image uses its own default ENTRYPOINT.
    // Pass all command elements as args (K8s `args` overrides CMD, not ENTRYPOINT),
    // so the image binary runs with these as its arguments.
    return { command: [], args: command };
  }

  return { command: [], args: [] };
}

/**
 * Create a ConfigMap containing the serialized input data.
 */
async function createInputConfigMap(
  name: string,
  namespace: string,
  inputData: unknown,
): Promise<void> {
  const core = getCoreApi();
  const body: k8s.V1ConfigMap = {
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'shipsec-worker',
        'shipsec.ai/purpose': 'job-input',
      },
    },
    data: {
      'input.json': JSON.stringify(inputData),
    },
  };
  await core.createNamespacedConfigMap({ namespace, body });
}

/**
 * Build the K8s Job spec from a DockerRunnerConfig.
 */
function buildJobSpec(
  jobName: string,
  namespace: string,
  configMapName: string,
  outputVolumeConfig: OutputVolumeConfig | null,
  runner: DockerRunnerConfig,
  context: ExecutionContext,
): BuildJobResult {
  const { command, args } = resolveK8sCommand(runner);
  const timeoutSeconds = runner.timeoutSeconds || 300;
  const nodeSelector = getJobNodeSelector(context);
  const tolerations = getJobTolerations(context);
  const podSecurityContext = getJobPodSecurityContext(context);
  const containerSecurityContext = getJobContainerSecurityContext(context);

  // Build env vars
  const envVars: k8s.V1EnvVar[] = [
    { name: 'SHIPSEC_INPUT_PATH', value: '/shipsec-input/input.json' },
  ];
  if ((runner as DockerRunnerConfig & { expectOutputFile?: boolean }).expectOutputFile !== false) {
    envVars.push({
      name: 'SHIPSEC_OUTPUT_PATH',
      value: `${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`,
    });
  }
  if (runner.env) {
    for (const [key, value] of Object.entries(runner.env)) {
      // Override HOME=/root for distroless images — /root is not writable
      if (key === 'HOME' && value === '/root') {
        envVars.push({ name: key, value: '/tmp' });
      } else {
        envVars.push({ name: key, value });
      }
    }
  }

  // Build volume mounts
  const volumeMounts: k8s.V1VolumeMount[] = [
    { name: 'input', mountPath: '/shipsec-input', readOnly: true },
  ];

  const volumes: k8s.V1Volume[] = [
    {
      name: 'input',
      configMap: { name: configMapName },
    },
  ];
  let hasGcsFuse = false;

  if (outputVolumeConfig) {
    volumeMounts.push({ name: 'output', mountPath: CONTAINER_OUTPUT_PATH });
    volumes.push({
      name: 'output',
      csi: {
        driver: 'gcsfuse.csi.storage.gke.io',
        readOnly: false,
        volumeAttributes: (() => {
          if (!outputVolumeConfig.source.startsWith('gcsfuse:')) {
            throw new ConfigurationError(
              'K8s runner requires a GCS-backed writable output volume for /shipsec-output',
              {
                details: { source: outputVolumeConfig.source },
              },
            );
          }
          const [, bucketName, ...prefixParts] = outputVolumeConfig.source.split(':');
          const onlyDir = prefixParts.join(':');
          return {
            bucketName,
            mountOptions: buildGcsFuseMountOptions(onlyDir, false),
          };
        })(),
      },
    });
    hasGcsFuse = true;
  }

  // Handle additional volumes (from IsolatedK8sVolume or IsolatedGcsVolume)
  if (runner.volumes) {
    for (let i = 0; i < runner.volumes.length; i++) {
      const vol = runner.volumes[i];
      if (!vol || !vol.source || !vol.target) continue;

      const volName = `extra-vol-${i}`;

      if (vol.source.startsWith('gcsfuse:')) {
        // GCS FUSE CSI volume from IsolatedGcsVolume
        // Parse "gcsfuse:{bucket}:{prefix}"
        const [, bucketName, ...prefixParts] = vol.source.split(':');
        const onlyDir = prefixParts.join(':');
        hasGcsFuse = true;
        volumes.push({
          name: volName,
          csi: {
            driver: 'gcsfuse.csi.storage.gke.io',
            readOnly: vol.readOnly ?? false,
            volumeAttributes: {
              bucketName,
              mountOptions: buildGcsFuseMountOptions(onlyDir, vol.readOnly ?? false),
            },
          },
        });
        // NO writableVolumeMappings tracking needed — GCS handles write natively
      } else if (vol.source.startsWith('configmap:') && (vol.readOnly ?? true)) {
        // ConfigMap-backed volume from IsolatedK8sVolume (read-only)
        const cmName = vol.source.replace('configmap:', '');
        volumes.push({
          name: volName,
          configMap: { name: cmName },
        });
      } else if (vol.source.startsWith('configmap:') && !(vol.readOnly ?? true)) {
        throw new ValidationError(
          `Writable ConfigMap-backed volumes are no longer supported in k8s mode: ${vol.target}`,
          {
            fieldErrors: {
              volumes: ['Use a GCS-backed isolated volume for writable mounts in k8s mode'],
            },
            details: { source: vol.source, target: vol.target },
          },
        );
      } else {
        // Treat as emptyDir (can't use host paths in K8s Jobs)
        volumes.push({
          name: volName,
          emptyDir: {},
        });
      }

      volumeMounts.push({
        name: volName,
        mountPath: vol.target,
        readOnly: vol.readOnly ?? false,
      });
    }
  }

  const job: k8s.V1Job = {
    metadata: {
      name: jobName,
      namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'shipsec-worker',
        'shipsec.ai/run-id': sanitizeName(context.runId),
        'shipsec.ai/component-ref': sanitizeName(context.componentRef),
      },
    },
    spec: {
      backoffLimit: 0, // no retries — Temporal handles retry logic
      activeDeadlineSeconds: timeoutSeconds,
      ttlSecondsAfterFinished: 120, // auto-cleanup after 2 min
      template: {
        metadata: {
          labels: {
            'app.kubernetes.io/managed-by': 'shipsec-worker',
            'shipsec.ai/run-id': sanitizeName(context.runId),
          },
          ...(hasGcsFuse ? { annotations: { 'gke-gcsfuse/volumes': 'true' } } : {}),
        },
        spec: {
          restartPolicy: 'Never',
          securityContext: podSecurityContext,
          ...(nodeSelector ? { nodeSelector } : {}),
          ...(tolerations ? { tolerations } : {}),
          ...(process.env.K8S_JOB_SERVICE_ACCOUNT
            ? { serviceAccountName: process.env.K8S_JOB_SERVICE_ACCOUNT }
            : {}),
          ...(hasGcsFuse ? { terminationGracePeriodSeconds: 60 } : {}),
          ...(process.env.K8S_IMAGE_PULL_SECRET
            ? { imagePullSecrets: [{ name: process.env.K8S_IMAGE_PULL_SECRET }] }
            : {}),
          containers: [
            {
              name: 'component',
              image: runner.image,
              imagePullPolicy:
                (process.env.K8S_JOB_IMAGE_PULL_POLICY as 'Always' | 'IfNotPresent' | 'Never') ||
                'IfNotPresent',
              command: command.length > 0 ? command : undefined,
              args: args.length > 0 ? args : undefined,
              env: envVars,
              tty: true,
              securityContext: containerSecurityContext,
              volumeMounts,
              resources: {
                requests: { cpu: '100m', memory: '128Mi' },
                limits: { cpu: '1000m', memory: '2Gi' },
              },
            },
          ],
          volumes,
        },
      },
    },
  };

  return { job, hasGcsFuse };
}

/**
 * Wait for a Job to complete (or fail/timeout).
 * Returns the pod name for log retrieval.
 */
async function waitForJobCompletion(
  jobName: string,
  namespace: string,
  timeoutMs: number,
  context: ExecutionContext,
): Promise<{ podName: string; succeeded: boolean }> {
  const batch = getBatchApi();
  const core = getCoreApi();
  const deadline = Date.now() + timeoutMs;

  // Find the pod created by this Job
  let podName = '';
  while (!podName && Date.now() < deadline) {
    const pods = await core.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });
    if (pods.items.length > 0) {
      podName = pods.items[0].metadata?.name || '';
    }
    if (!podName) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!podName) {
    throw new TimeoutError(`Timed out waiting for Job pod to appear: ${jobName}`, timeoutMs);
  }

  context.logger.info(`[K8sRunner] Job ${jobName} → pod ${podName}`);

  // Stream logs in real-time while waiting
  const logPromise = streamPodLogs(podName, namespace, context).catch((err) => {
    context.logger.warn(`[K8sRunner] Log streaming error: ${err.message}`);
  });

  // Poll Job status until done
  while (Date.now() < deadline) {
    const job = await batch.readNamespacedJob({ name: jobName, namespace });
    const status = job.status;

    if (status?.succeeded && status.succeeded > 0) {
      await logPromise;
      return { podName, succeeded: true };
    }
    if (status?.failed && status.failed > 0) {
      await logPromise;
      return { podName, succeeded: false };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new TimeoutError(`Job ${jobName} timed out after ${timeoutMs / 1000}s`, timeoutMs, {
    details: { jobName, podName },
  });
}

/**
 * Stream pod logs to the context logger and terminal collector.
 * Uses the K8s Log API with a writable stream to capture output in real-time.
 */
async function streamPodLogs(
  podName: string,
  namespace: string,
  context: ExecutionContext,
): Promise<void> {
  const core = getCoreApi();
  const kc = getKubeConfig();
  const log = new k8s.Log(kc);

  // Wait for container to be ready (running or already terminated)
  const deadline = Date.now() + 60_000;
  let containerTerminated = false;
  while (Date.now() < deadline) {
    const pod = await core.readNamespacedPod({ name: podName, namespace });
    const cs = pod.status?.containerStatuses?.find((c) => c.name === 'component');
    if (cs?.state?.terminated) {
      containerTerminated = true;
      break;
    }
    if (cs?.state?.running) {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  let chunkIndex = 0;
  let lastTimestamp = Date.now();
  const emitToCollectors = (text: string) => {
    if (context.terminalCollector) {
      chunkIndex += 1;
      const now = Date.now();
      const deltaMs = chunkIndex === 1 ? 0 : Math.max(0, now - lastTimestamp);
      lastTimestamp = now;
      context.terminalCollector({
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'pty',
        chunkIndex,
        payload: Buffer.from(text).toString('base64'),
        recordedAt: new Date(now).toISOString(),
        deltaMs,
        origin: 'k8s-job',
        runnerKind: 'k8s',
      });
    }
    if (context.logCollector) {
      context.logCollector({
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stdout',
        level: 'info',
        message: text,
        timestamp: new Date().toISOString(),
      });
    }
  };

  // If container already terminated, read final logs instead of following
  if (containerTerminated) {
    try {
      const logResponse = await core.readNamespacedPodLog({
        name: podName,
        namespace,
        container: 'component',
      });
      const logText = typeof logResponse === 'string' ? logResponse : String(logResponse);
      if (logText) {
        emitToCollectors(logText);
      }
    } catch (err) {
      context.logger.warn(
        `[K8sRunner] Failed to read terminated pod logs: ${(err as Error).message}`,
      );
    }
    return;
  }

  // Container is running — attach to PTY for real-time streaming
  const { Writable } = await import('stream');

  const stdoutSink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      emitToCollectors(chunk.toString());
      callback();
    },
  });

  try {
    context.logger.info(`[K8sRunner] Attaching to pod ${podName} with TTY for live PTY stream`);
    const attach = new k8s.Attach(kc);
    const ws = await attach.attach(
      namespace,
      podName,
      'component',
      stdoutSink,
      stdoutSink,
      null,
      true,
    );

    // Wait for the WebSocket to close (container exits → WS closes)
    await new Promise<void>((resolve, reject) => {
      ws.onclose = () => {
        context.logger.info(`[K8sRunner] Attach WebSocket closed for pod ${podName}`);
        resolve();
      };
      ws.onerror = (event) => {
        context.logger.warn(`[K8sRunner] Attach WebSocket error: ${String(event)}`);
        reject(new Error('Attach WebSocket error'));
      };
    });
  } catch (err) {
    context.logger.warn(
      `[K8sRunner] Attach failed, falling back to log stream: ${(err as Error).message}`,
    );
    // Fallback to log API if attach fails
    const { PassThrough } = await import('stream');
    const logStream = new PassThrough();
    logStream.on('data', (chunk: Buffer) => {
      emitToCollectors(chunk.toString());
    });
    try {
      await log.log(namespace, podName, 'component', logStream, {
        follow: true,
        pretty: false,
        timestamps: false,
      });
    } catch (logErr) {
      context.logger.warn(`[K8sRunner] Log streaming also failed: ${(logErr as Error).message}`);
    }
  }
}

/**
 * Read final pod logs after completion.
 */
async function readPodLogs(podName: string, namespace: string): Promise<string> {
  const core = getCoreApi();
  const logResponse = await core.readNamespacedPodLog({
    name: podName,
    namespace,
    container: 'component',
  });
  // The response can be a string directly
  return typeof logResponse === 'string' ? logResponse : String(logResponse);
}

async function readRunnerOutputFromVolume<O>(
  outputVolume: IsolatedVolume,
  _context: ExecutionContext,
): Promise<O> {
  const files = await outputVolume.readFiles([OUTPUT_FILENAME]);
  const rawOutput = files[OUTPUT_FILENAME];

  if (typeof rawOutput !== 'string' || rawOutput.trim().length === 0) {
    throw new ContainerError(
      `K8s Job completed without writing required output file: ${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`,
      {
        details: { outputPath: `${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}` },
      },
    );
  }

  try {
    return JSON.parse(rawOutput) as O;
  } catch (error) {
    throw new ValidationError(`Failed to parse K8s job output JSON: ${(error as Error).message}`, {
      cause: error as Error,
    });
  }
}

/**
 * Wait for the GCS FUSE sidecar container to terminate after the main
 * container exits. This ensures all writes are flushed to GCS before
 * the worker reads output via the GCS SDK.
 */
async function waitForGcsFuseFlush(
  podName: string,
  namespace: string,
  context: ExecutionContext,
): Promise<void> {
  const core = getCoreApi();
  const deadline = Date.now() + 60_000; // max 60s wait

  context.logger.info(`[K8sRunner] Waiting for GCS FUSE sidecar flush on pod ${podName}`);

  while (Date.now() < deadline) {
    const pod = await core.readNamespacedPod({ name: podName, namespace });
    // GCS FUSE sidecar may appear in containerStatuses (K8s ≥1.28 native sidecar)
    // or initContainerStatuses (older injection approach)
    const allStatuses = [
      ...(pod.status?.containerStatuses ?? []),
      ...(pod.status?.initContainerStatuses ?? []),
    ];
    const sidecar = allStatuses.find((c) => c.name === 'gke-gcsfuse-sidecar');

    if (!sidecar) {
      // No sidecar found — GCS FUSE may not have been injected, skip wait
      context.logger.info(`[K8sRunner] No GCS FUSE sidecar found, skipping flush wait`);
      return;
    }

    if (sidecar.state?.terminated) {
      context.logger.info(`[K8sRunner] GCS FUSE sidecar terminated, flush complete`);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  context.logger.warn(`[K8sRunner] GCS FUSE sidecar did not terminate within 60s, proceeding`);
}

/**
 * Clean up resources created for a Job execution.
 */
async function cleanup(
  jobName: string,
  configMapName: string,
  namespace: string,
  context: ExecutionContext,
): Promise<void> {
  const batch = getBatchApi();
  const core = getCoreApi();

  try {
    await batch.deleteNamespacedJob({
      name: jobName,
      namespace,
      body: { propagationPolicy: 'Background' },
    });
  } catch (err) {
    context.logger.warn(`[K8sRunner] Failed to delete Job ${jobName}: ${(err as Error).message}`);
  }

  try {
    await core.deleteNamespacedConfigMap({ name: configMapName, namespace });
  } catch (err) {
    context.logger.warn(
      `[K8sRunner] Failed to delete ConfigMap ${configMapName}: ${(err as Error).message}`,
    );
  }
}

/**
 * Execute a component as a Kubernetes Job.
 *
 * Drop-in replacement for runComponentInDocker — same signature,
 * registered via setDockerRunnerOverride() at worker startup.
 */
export async function runComponentInK8sJob<I, O>(
  runner: DockerRunnerConfig,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  const namespace = getJobNamespace();
  const jobName = generateJobName(context, runner.image);
  const configMapName = `${jobName}-input`;
  const timeoutMs = (runner.timeoutSeconds || 300) * 1000;

  context.logger.info(
    `[K8sRunner] Creating Job ${jobName} in ${namespace} (image: ${runner.image})`,
  );
  context.emitProgress(`Launching K8s Job: ${runner.image}`);

  const tenantId = (context as any).tenantId ?? 'default-tenant';
  const expectsOutputFile =
    (runner as DockerRunnerConfig & { expectOutputFile?: boolean }).expectOutputFile !== false;
  const outputVolume = expectsOutputFile
    ? createIsolatedVolume(tenantId, `${context.runId}-runner-output`)
    : null;

  try {
    // 1. Create input ConfigMap
    await createInputConfigMap(configMapName, namespace, params);
    context.logger.info(`[K8sRunner] Created ConfigMap ${configMapName}`);

    // 2. Create writable shared output volume for the canonical result file when required
    let outputVolumeConfig: OutputVolumeConfig | null = null;
    if (outputVolume) {
      const outputVolumeName = await outputVolume.initialize({});
      outputVolumeConfig = outputVolume.getVolumeConfig(CONTAINER_OUTPUT_PATH, false);
      context.logger.info(
        `[K8sRunner] Created output volume ${outputVolumeName} for ${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`,
      );
    }

    // 3. Create Job
    const { job: jobSpec, hasGcsFuse: hasGcsFuseVolume } = buildJobSpec(
      jobName,
      namespace,
      configMapName,
      outputVolumeConfig,
      runner,
      context,
    );
    await getBatchApi().createNamespacedJob({ namespace, body: jobSpec });
    context.logger.info(`[K8sRunner] Created Job ${jobName}`);

    // 4. Wait for completion
    const { podName, succeeded } = await waitForJobCompletion(
      jobName,
      namespace,
      timeoutMs,
      context,
    );

    // 5. Read final logs for diagnostics / UI
    const logs = await readPodLogs(podName, namespace);

    if (!succeeded) {
      context.logger.error(`[K8sRunner] Job ${jobName} failed`);
      throw new ContainerError(`K8s Job failed: ${jobName}`, {
        details: { jobName, podName, logs: logs.slice(-500) },
      });
    }

    context.logger.info(`[K8sRunner] Job ${jobName} completed successfully`);
    context.emitProgress('K8s Job completed');

    // 5.5 Wait for GCS FUSE sidecar to flush writes before reading output
    if (hasGcsFuseVolume) {
      await waitForGcsFuseFlush(podName, namespace, context);
    }

    // 6. Read structured output directly from the shared output volume when required
    if (outputVolume) {
      return await readRunnerOutputFromVolume<O>(outputVolume, context);
    }

    context.logger.info('[K8sRunner] Runner configured without structured output file');
    return undefined as O;
  } finally {
    await outputVolume?.cleanup();
    // 7. Cleanup
    await cleanup(jobName, configMapName, namespace, context);
  }
}
