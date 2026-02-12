/**
 * K8s Job Runner — executes component containers as Kubernetes Jobs
 * instead of shelling out to `docker run`.
 *
 * Replaces DIND entirely. The worker pod needs a ServiceAccount with
 * RBAC to create Jobs, ConfigMaps, and read pod logs in the target namespace.
 */
import * as k8s from '@kubernetes/client-node';
import type { DockerRunnerConfig, ExecutionContext } from '@shipsec/component-sdk';
import { ContainerError, TimeoutError } from '@shipsec/component-sdk';

// Output delimiter — the K8s runner wraps commands to emit the output file
// to stdout after the main process exits. The worker parses logs looking for
// this marker to separate component logs from structured output.
const OUTPUT_DELIMITER = '___SHIPSEC_K8S_OUTPUT___';
const VOLUME_DELIMITER = '___SHIPSEC_K8S_VOLUME_DATA___';

const CONTAINER_OUTPUT_PATH = '/shipsec-output';
const OUTPUT_FILENAME = 'result.json';

interface BuildJobResult {
  job: k8s.V1Job;
  writableVolumeMappings: Map<string, string>; // mountPath → configMapName
}

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

/**
 * Shell snippet that captures files from writable volume mounts.
 * Reads $SHIPSEC_WRITABLE_MOUNTS (space-separated paths) and emits
 * each file as base64 between markers so the worker can parse them
 * from pod logs and write them back to their backing ConfigMaps.
 */
const VOLUME_CAPTURE_SCRIPT = [
  `echo '${VOLUME_DELIMITER}'`,
  'for __mp in $SHIPSEC_WRITABLE_MOUNTS; do',
  '  find "$__mp" -type f 2>/dev/null | while IFS= read -r __f; do',
  '    __rel="${__f#$__mp/}"',
  '    echo "___FILE_START___:$__mp:$__rel"',
  '    base64 "$__f" 2>/dev/null || true',
  '    echo "___FILE_END___"',
  '  done',
  'done',
].join('; ');

/**
 * Build the command wrapper that emits the output file to stdout.
 *
 * For images with a shell: wraps original command so that after it exits,
 * the output file is printed to stdout with a delimiter prefix.
 * If writable volumes exist, also captures their contents as base64.
 *
 * For images without a shell (distroless): returns original command as-is,
 * relying on stdout-based output fallback.
 */
function wrapCommandForOutput(runner: DockerRunnerConfig): { command: string[]; args: string[] } {
  const { entrypoint, command } = runner;

  // Volume capture suffix — only emits data when SHIPSEC_WRITABLE_MOUNTS is set
  const volCapture = `; if [ -n "$SHIPSEC_WRITABLE_MOUNTS" ]; then ${VOLUME_CAPTURE_SCRIPT}; fi`;

  const isShellEntrypoint =
    entrypoint === 'sh' ||
    entrypoint === 'bash' ||
    entrypoint === '/bin/sh' ||
    entrypoint === '/bin/bash';

  if (isShellEntrypoint && command.length >= 2 && command[0] === '-c') {
    // Shell wrapper pattern: entrypoint=sh, command=['-c', 'binary "$@"', '--', ...dynamicArgs]
    const shellScript = command[1];
    const dynamicArgsMatch = shellScript.match(/^(\S+)\s+"\$@"$/);

    if (dynamicArgsMatch) {
      // Dynamic args pattern for distroless images (e.g., 'subfinder "$@"')
      // These images don't have sh — use their default ENTRYPOINT directly.
      // The dynamic args follow after '--' in the command array.
      const dashDashIdx = command.indexOf('--');
      const dynamicArgs = dashDashIdx >= 0 ? command.slice(dashDashIdx + 1) : [];
      // Return empty command to use image's ENTRYPOINT, pass dynamic args directly
      return { command: [], args: dynamicArgs };
    }

    // Regular shell script — wrap with output capture
    const userScript = command.slice(1).join(' ');
    const wrapped = `${userScript}; __exit=$?; echo '${OUTPUT_DELIMITER}'; cat ${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME} 2>/dev/null || echo '{}'${volCapture}; exit $__exit`;
    return { command: [entrypoint!], args: ['-c', wrapped] };
  }

  if (isShellEntrypoint) {
    return { command: [entrypoint!], args: command };
  }

  // For non-shell entrypoints (e.g., 'httpx', 'nuclei', binary entrypoints):
  // Use the entrypoint directly — the image may be distroless (no /bin/sh).
  // Output is captured from stdout via parseOutputFromLogs fallback.
  if (entrypoint) {
    return { command: [entrypoint], args: command };
  }

  if (command.length > 0) {
    return { command: [command[0]], args: command.slice(1) };
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
  runner: DockerRunnerConfig,
  context: ExecutionContext,
): BuildJobResult {
  const { command, args } = wrapCommandForOutput(runner);
  const timeoutSeconds = runner.timeoutSeconds || 300;

  // Track writable ConfigMap volumes for post-execution data capture
  const writableVolumeMappings = new Map<string, string>();

  // Build env vars
  const envVars: k8s.V1EnvVar[] = [
    { name: 'SHIPSEC_INPUT_PATH', value: '/shipsec-input/input.json' },
    { name: 'SHIPSEC_OUTPUT_PATH', value: `${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}` },
  ];
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
    { name: 'output', mountPath: CONTAINER_OUTPUT_PATH },
  ];

  const volumes: k8s.V1Volume[] = [
    {
      name: 'input',
      configMap: { name: configMapName },
    },
    {
      name: 'output',
      emptyDir: {},
    },
  ];

  // Handle additional volumes (from IsolatedK8sVolume)
  if (runner.volumes) {
    for (let i = 0; i < runner.volumes.length; i++) {
      const vol = runner.volumes[i];
      if (!vol || !vol.source || !vol.target) continue;

      const volName = `extra-vol-${i}`;

      if (vol.source.startsWith('configmap:') && (vol.readOnly ?? true)) {
        // ConfigMap-backed volume from IsolatedK8sVolume (read-only)
        const cmName = vol.source.replace('configmap:', '');
        volumes.push({
          name: volName,
          configMap: { name: cmName },
        });
      } else if (vol.source.startsWith('configmap:') && !(vol.readOnly ?? true)) {
        const cmName = vol.source.replace('configmap:', '');
        // Use emptyDir for the actual mount (ConfigMaps are read-only in K8s)
        volumes.push({
          name: volName,
          emptyDir: {},
        });
        // Track for post-execution data capture
        writableVolumeMappings.set(vol.target, cmName);
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

  // Add env var for writable mount paths so the shell wrapper can capture files
  if (writableVolumeMappings.size > 0) {
    envVars.push({
      name: 'SHIPSEC_WRITABLE_MOUNTS',
      value: Array.from(writableVolumeMappings.keys()).join(' '),
    });
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
        },
        spec: {
          restartPolicy: 'Never',
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

  return { job, writableVolumeMappings };
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

  const emitToCollectors = (text: string) => {
    if (context.terminalCollector) {
      context.terminalCollector({
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stdout',
        chunkIndex: 0,
        payload: text,
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
        origin: 'k8s-job',
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

  // Container is running — stream logs in real-time
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
  } catch (err) {
    context.logger.warn(`[K8sRunner] Log streaming failed: ${(err as Error).message}`);
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

/**
 * Parse the volume data section from pod logs.
 * Returns a nested map: mountPath -> (relativeFilePath -> base64Content).
 */
function extractVolumeDataFromLogs(logs: string): Map<string, Map<string, string>> {
  const FILE_START = '___FILE_START___:';
  const FILE_END = '___FILE_END___';

  const result = new Map<string, Map<string, string>>();

  const volIdx = logs.lastIndexOf(VOLUME_DELIMITER);
  if (volIdx === -1) return result;

  const volSection = logs.slice(volIdx + VOLUME_DELIMITER.length);
  const lines = volSection.split('\n');

  let currentMount = '';
  let currentFile = '';
  let currentData: string[] = [];
  let inFile = false;

  for (const line of lines) {
    if (line.startsWith(FILE_START)) {
      // Parse mount path and relative path
      const rest = line.slice(FILE_START.length);
      const firstColon = rest.indexOf(':');
      if (firstColon === -1) continue;
      currentMount = rest.slice(0, firstColon);
      currentFile = rest.slice(firstColon + 1);
      currentData = [];
      inFile = true;
    } else if (line.trim() === FILE_END && inFile) {
      // Save the file
      if (!result.has(currentMount)) {
        result.set(currentMount, new Map());
      }
      result.get(currentMount)!.set(currentFile, currentData.join('\n'));
      inFile = false;
    } else if (inFile) {
      currentData.push(line);
    }
  }

  return result;
}

/**
 * Write captured volume data back to their backing ConfigMaps.
 * This allows volume.readFiles() to access output data after the pod terminates.
 */
async function writeBackVolumeData(
  volumeData: Map<string, Map<string, string>>,
  writableVolumeMappings: Map<string, string>,
  namespace: string,
  context: ExecutionContext,
): Promise<void> {
  const core = getCoreApi();

  for (const [mountPath, files] of volumeData) {
    const cmName = writableVolumeMappings.get(mountPath);
    if (!cmName) continue;

    const binaryData: Record<string, string> = {};

    for (const [relPath, base64Content] of files) {
      // Flatten path separators same as IsolatedK8sVolume
      const key = relPath.replace(/\//g, '__');
      // Store as binaryData (base64) to handle any file type
      binaryData[key] = base64Content;
    }

    try {
      // Read existing ConfigMap and merge
      const existing = await core.readNamespacedConfigMap({ name: cmName, namespace });
      const body: k8s.V1ConfigMap = {
        ...existing,
        data: { ...(existing.data || {}) },
        binaryData: { ...(existing.binaryData || {}), ...binaryData },
      };
      await core.replaceNamespacedConfigMap({ name: cmName, namespace, body });
      context.logger.info(`[K8sRunner] Wrote back ${files.size} files to ConfigMap ${cmName}`);
    } catch (err) {
      context.logger.warn(
        `[K8sRunner] Failed to write back volume data to ${cmName}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Parse component output from pod logs.
 * Looks for the OUTPUT_DELIMITER marker — everything after it is the JSON output.
 * Falls back to parsing the full stdout as JSON.
 */
function parseOutputFromLogs<O>(logs: string, context: ExecutionContext): O {
  // Strip volume data section if present (comes after output)
  let cleanLogs = logs;
  const volIdx = cleanLogs.lastIndexOf(VOLUME_DELIMITER);
  if (volIdx !== -1) {
    cleanLogs = cleanLogs.slice(0, volIdx);
  }

  // Look for the output delimiter
  const delimiterIdx = cleanLogs.lastIndexOf(OUTPUT_DELIMITER);
  if (delimiterIdx !== -1) {
    const outputStr = cleanLogs.slice(delimiterIdx + OUTPUT_DELIMITER.length).trim();
    if (outputStr) {
      try {
        return JSON.parse(outputStr) as O;
      } catch (e) {
        context.logger.warn(
          `[K8sRunner] Failed to parse delimited output: ${(e as Error).message}`,
        );
      }
    }
  }

  // Fallback: try parsing the last line as JSON
  const lines = cleanLogs.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        return JSON.parse(line) as O;
      } catch {
        continue;
      }
    }
  }

  // Fallback: return raw logs as string output
  context.logger.warn('[K8sRunner] No structured output found, returning raw stdout');
  return cleanLogs.trim() as unknown as O;
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

  try {
    // 1. Create input ConfigMap
    await createInputConfigMap(configMapName, namespace, params);
    context.logger.info(`[K8sRunner] Created ConfigMap ${configMapName}`);

    // 2. Create Job
    const { job: jobSpec, writableVolumeMappings } = buildJobSpec(
      jobName,
      namespace,
      configMapName,
      runner,
      context,
    );
    await getBatchApi().createNamespacedJob({ namespace, body: jobSpec });
    context.logger.info(`[K8sRunner] Created Job ${jobName}`);

    // 3. Wait for completion
    const { podName, succeeded } = await waitForJobCompletion(
      jobName,
      namespace,
      timeoutMs,
      context,
    );

    // 4. Read final logs
    const logs = await readPodLogs(podName, namespace);

    if (!succeeded) {
      context.logger.error(`[K8sRunner] Job ${jobName} failed`);
      throw new ContainerError(`K8s Job failed: ${jobName}`, {
        details: { jobName, podName, logs: logs.slice(-500) },
      });
    }

    context.logger.info(`[K8sRunner] Job ${jobName} completed successfully`);
    context.emitProgress('K8s Job completed');

    // 4.5. Write back writable volume data to ConfigMaps
    // Must happen BEFORE cleanup so volume.readFiles() can access updated ConfigMaps
    if (writableVolumeMappings.size > 0) {
      const volumeData = extractVolumeDataFromLogs(logs);
      if (volumeData.size > 0) {
        await writeBackVolumeData(volumeData, writableVolumeMappings, namespace, context);
      }
    }

    // 5. Parse output
    return parseOutputFromLogs<O>(logs, context);
  } finally {
    // 6. Cleanup
    await cleanup(jobName, configMapName, namespace, context);
  }
}
