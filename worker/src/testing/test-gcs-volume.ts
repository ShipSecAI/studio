#!/usr/bin/env bun
/**
 * End-to-end integration test for GCS FUSE volume sharing.
 *
 * Validates the full flow:
 *   1. IsolatedGcsVolume.initialize() uploads files to GCS
 *   2. K8s job mounts them via GCS FUSE CSI at /inputs
 *   3. Job reads the file, writes output to /shipsec-output/result.json
 *   4. Worker reads the JSON output from pod logs
 *   5. volume.cleanup() removes GCS objects
 *
 * Run inside the worker pod:
 *   kubectl exec -n shipsec-workers <pod> -- bun run /app/worker/src/testing/test-gcs-volume.ts
 */

import { IsolatedGcsVolume } from '../utils/gcs-volume';
import { runComponentInK8sJob } from '../utils/k8s-runner';
import type { ExecutionContext } from '@shipsec/component-sdk';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

function makeContext(): ExecutionContext {
  return {
    runId: `test-gcs-${Date.now()}`,
    componentRef: 'test.gcs.volume',
    logger: {
      info: (msg: string) => console.log(`  [info] ${msg}`),
      warn: (msg: string) => console.warn(`  [warn] ${msg}`),
      error: (msg: string) => console.error(`  [error] ${msg}`),
      debug: (msg: string) => console.log(`  [debug] ${msg}`),
    },
    emitProgress: (msg: string) => console.log(`  [progress] ${msg}`),
    secrets: undefined,
    storage: undefined,
    artifacts: undefined,
    trace: undefined,
    logCollector: undefined,
    terminalCollector: undefined,
    metadata: { runId: `test-gcs-${Date.now()}`, componentRef: 'test.gcs.volume' },
    http: { fetch: fetch as any, toCurl: () => '' },
  } as any;
}

async function testVolumeWriteRead() {
  console.log('\n── Test 1: GCS volume write → K8s job read ──');

  const volume = new IsolatedGcsVolume('testtenant', `run${Date.now()}`);
  const testContent = `hello-from-gcs-${Date.now()}`;

  // 1. Upload file to GCS
  const prefix = await volume.initialize({ 'input.txt': testContent });
  console.log(`  ${PASS} Uploaded input.txt to GCS prefix: ${prefix}`);

  const ctx = makeContext();

  // 2. Runner: alpine reads /inputs/input.txt and writes JSON output
  const runner: DockerRunnerConfig = {
    kind: 'docker',
    image: 'alpine:3.20',
    entrypoint: 'sh',
    command: [
      '-c',
      `content=$(cat /inputs/input.txt); printf '{"content":"%s"}' "$content" > /shipsec-output/result.json`,
    ],
    timeoutSeconds: 60,
    volumes: [volume.getVolumeConfig('/inputs', true)],
  };

  try {
    const result = await runComponentInK8sJob<unknown, { content: string }>(runner, {}, ctx);
    console.log(`  ${PASS} K8s job completed, result:`, result);

    if (result?.content === testContent) {
      console.log(`  ${PASS} Content matches! "${result.content}"`);
    } else {
      console.error(
        `  ${FAIL} Content mismatch: expected "${testContent}", got "${result?.content}"`,
      );
      process.exit(1);
    }
  } finally {
    await volume.cleanup();
    console.log(`  ${PASS} GCS volume cleaned up`);
  }
}

async function testVolumeCleanup() {
  console.log('\n── Test 2: GCS volume cleanup removes objects ──');

  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(process.env.GCS_VOLUME_BUCKET!);

  const volume = new IsolatedGcsVolume('testcleanup', `run${Date.now()}`);
  await volume.initialize({ 'deleteme.txt': 'temporary' });
  const prefix = volume.getVolumeName()!;

  // Verify file exists
  const [before] = await bucket.getFiles({ prefix });
  if (before.length === 0) {
    console.error(`  ${FAIL} File not found in GCS before cleanup`);
    process.exit(1);
  }
  console.log(`  ${PASS} File exists in GCS (${before.length} object(s))`);

  await volume.cleanup();

  // Verify file deleted
  const [after] = await bucket.getFiles({ prefix });
  if (after.length === 0) {
    console.log(`  ${PASS} GCS objects cleaned up successfully`);
  } else {
    console.error(`  ${FAIL} ${after.length} objects still remain after cleanup`);
    process.exit(1);
  }
}

async function main() {
  console.log('🧪 GCS FUSE Volume Integration Tests');
  console.log(`   EXECUTION_MODE=${process.env.EXECUTION_MODE}`);
  console.log(`   GCS_VOLUME_BUCKET=${process.env.GCS_VOLUME_BUCKET}`);
  console.log(`   K8S_JOB_NAMESPACE=${process.env.K8S_JOB_NAMESPACE}`);

  if (!process.env.GCS_VOLUME_BUCKET) {
    console.error(`${FAIL} GCS_VOLUME_BUCKET not set`);
    process.exit(1);
  }

  await testVolumeCleanup();
  await testVolumeWriteRead();

  console.log('\n\x1b[32m✓ All tests passed\x1b[0m\n');
}

main().catch((err) => {
  console.error(`\n${FAIL} Test failed:`, err);
  process.exit(1);
});
