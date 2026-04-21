import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
const enableDockerIntegration = process.env.ENABLE_DOCKER_TESTS === 'true';
const dockerAvailable = (() => {
  try {
    const result = Bun.spawnSync(['docker', 'version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

const dockerDescribe = enableDockerIntegration && dockerAvailable ? describe : describe.skip;

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

async function runBash(command: string, timeoutMs = 120_000) {
  const proc = Bun.spawn(['bash', '-lc', command], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: repoRoot,
  });

  const timedOut = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.exited.finally(() => clearTimeout(timer));
  });

  const [stdout, stderr, exitCode] = await Promise.race([
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
    timedOut,
  ]);

  return { stdout, stderr, exitCode };
}

function stripDockerPlatformWarnings(stderr: string): string {
  return stderr
    .split('\n')
    .filter(
      (line) =>
        !line.includes(
          "WARNING: The requested image's platform (linux/amd64) does not match the detected host platform",
        ),
    )
    .join('\n')
    .trim();
}

async function makeSampleRepo() {
  const repoDir = await makeTempDir('tool-output-repo-');
  await writeFile(
    join(repoDir, 'api-service.js'),
    `
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();

const JWT_SECRET = 'shipsec-prod-jwt-secret-7f3b9c2d8e4a1b6c';
const AWS_ACCESS_KEY = 'AKIAQWER1234ZXCVBNM9';
const AWS_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9qLmN0pRs';

app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(3000);
`.trim(),
  );
  await writeFile(
    join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'tool-output-sample',
        version: '1.0.0',
        private: true,
        dependencies: {
          express: '4.21.2',
          jsonwebtoken: '9.0.2',
          mysql2: '3.14.5',
        },
      },
      null,
      2,
    ),
  );
  return repoDir;
}

dockerDescribe('Docker Tool Output Contracts', () => {
  test('trufflehog keeps findings in file and logs on stderr', async () => {
    const repoDir = await makeSampleRepo();
    const outDir = await makeTempDir('trufflehog-out-');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${repoDir}:/scan/repo" \
        -v "${outDir}:/tool-output" \
        --entrypoint sh \
        trufflesecurity/trufflehog:3.93.7 \
        -c 'trufflehog "$@" 1>/tool-output/trufflehog.ndjson' -- \
        filesystem /scan/repo --json --no-update --no-color --fail-on-scan-errors
    `);

    const report = await readFile(join(outDir, 'trufflehog.ndjson'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr).toContain('"running source"');
    expect(report).toContain('"DetectorName":"AWS"');
  }, 120_000);

  test('vet writes JSON report file while keeping console output visible', async () => {
    const repoDir = await makeSampleRepo();
    const outDir = await makeTempDir('vet-out-');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${repoDir}:/scan" \
        -v "${outDir}:/tool-output" \
        ghcr.io/safedep/vet:latest \
        scan -D /scan \
        --report-json /tool-output/vet-report.json \
        --report-console \
        --report-summary \
        --no-banner
    `);

    const report = await readFile(join(outDir, 'vet-report.json'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stderr.length).toBeGreaterThan(0);
    expect(report.trim().startsWith('{')).toBe(true);
  }, 120_000);

  test('trivy writes report only to file in quiet mode', async () => {
    const repoDir = await makeSampleRepo();
    const outDir = await makeTempDir('trivy-out-');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${repoDir}:/scan:ro" \
        -v "${outDir}:/tool-output" \
        aquasec/trivy:latest \
        fs --format json --quiet -o /tool-output/trivy-report.json /scan
    `);

    const report = await readFile(join(outDir, 'trivy-report.json'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(stderr.trim()).toBe('');
    expect(() => JSON.parse(report)).not.toThrow();
  }, 120_000);

  test('opengrep writes JSON report to file even if stdout still mirrors results', async () => {
    const repoDir = await makeSampleRepo();
    const outDir = await makeTempDir('opengrep-out-');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        --entrypoint opengrep \
        -v "${repoDir}:/workspace/repo:ro" \
        -v "${outDir}:/tool-output" \
        realgam3/opengrep:latest \
        scan --json --json-output /tool-output/opengrep.json \
        --no-git-ignore --metrics=off \
        --config p/default --config p/security-audit \
        /workspace/repo
    `);

    const report = await readFile(join(outDir, 'opengrep.json'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stderr.length).toBeGreaterThan(0);
    expect(report).toContain('"results"');
    expect(report).toContain('AKIAQWER1234ZXCVBNM9');
  }, 120_000);

  test('nuclei writes JSONL file even when stdout/stderr stay noisy', async () => {
    const ioDir = await makeTempDir('nuclei-io-');
    await mkdir(ioDir, { recursive: true });
    await writeFile(join(ioDir, 'targets.txt'), 'https://example.com\n');
    await writeFile(
      join(ioDir, 'template.yaml'),
      `
id: example-domain-word
info:
  name: Example Domain Body Match
  author: codex
  severity: low
http:
  - method: GET
    path:
      - "{{BaseURL}}"
    matchers:
      - type: word
        part: body
        words:
          - "Example Domain"
`.trim(),
    );

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${ioDir}:/inputs" \
        ghcr.io/shipsecai/nuclei:latest \
        -duc -jsonl -stream -verbose \
        -l /inputs/targets.txt \
        -t /inputs/template.yaml \
        -o /inputs/nuclei-output.jsonl
    `);

    const report = await readFile(join(ioDir, 'nuclei-output.jsonl'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stdout.length + stderr.length).toBeGreaterThan(0);
    expect(report.trim().split('\n')).toHaveLength(1);
    expect(report).toContain('"template-id":"example-domain-word"');
  }, 120_000);

  test('httpx duplicates output to stdout but still writes stable JSONL file', async () => {
    const ioDir = await makeTempDir('httpx-io-');
    await writeFile(join(ioDir, 'targets.txt'), 'https://example.com\n');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${ioDir}:/inputs" \
        ghcr.io/shipsecai/httpx:latest \
        -json -silent -stream -ip \
        -l /inputs/targets.txt \
        -o /inputs/httpx-output.jsonl
    `);

    const report = await readFile(join(ioDir, 'httpx-output.jsonl'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stripDockerPlatformWarnings(stderr)).toBe('');
    expect(stdout).toContain('"url":"https://example.com"');
    expect(report).toContain('"url":"https://example.com"');
  }, 120_000);

  test('dnsx duplicates output to stdout but still writes stable JSONL file', async () => {
    const ioDir = await makeTempDir('dnsx-io-');
    await writeFile(join(ioDir, 'domains.txt'), 'example.com\n');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm \
        -v "${ioDir}:/inputs" \
        ghcr.io/shipsecai/dnsx:latest \
        -l /inputs/domains.txt \
        -json -silent -a -resp \
        -o /inputs/dnsx-output.jsonl
    `);

    const report = await readFile(join(ioDir, 'dnsx-output.jsonl'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stripDockerPlatformWarnings(stderr)).toBe('');
    expect(stdout).toContain('"host":"example.com"');
    expect(report).toContain('"host":"example.com"');
  }, 120_000);

  test('naabu file output is cleaner than stdout duplicates', async () => {
    const ioDir = await makeTempDir('naabu-io-');
    await writeFile(join(ioDir, 'targets.txt'), 'scanme.sh\n');

    const { stdout, stderr, exitCode } = await runBash(`
      docker run --rm --network bridge \
        -v "${ioDir}:/inputs" \
        ghcr.io/shipsecai/naabu:latest \
        -list /inputs/targets.txt \
        -json -silent -stream \
        -p 80,443 -rate 100 \
        -o /inputs/naabu-output.jsonl
    `);

    const report = await readFile(join(ioDir, 'naabu-output.jsonl'), 'utf8');
    expect(exitCode).toBe(0);
    expect(stripDockerPlatformWarnings(stderr)).toBe('');
    expect(stdout.trim().split('\n').length).toBeGreaterThan(report.trim().split('\n').length);
    expect(report).toContain('"port":80');
    expect(report).toContain('"port":443');
  }, 120_000);
});
