import { describe, expect, it } from 'bun:test';

import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import { buildGcsFuseMountOptions, wrapCommandForOutput } from '../k8s-runner';

describe('wrapCommandForOutput', () => {
  it('passes through exact dynamic entrypoint wrappers for distroless images', () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: 'ghcr.io/example/subfinder:latest',
      entrypoint: 'sh',
      command: ['-c', 'subfinder "$@"', '--', '-d', 'example.com'],
      timeoutSeconds: 60,
    };

    expect(wrapCommandForOutput(runner)).toEqual({
      command: [],
      args: ['-d', 'example.com'],
    });
  });

  it('preserves shell positional args when setup commands also use "$@"', () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: 'trufflesecurity/trufflehog:latest',
      entrypoint: 'sh',
      command: [
        '-c',
        `printf '%s\\n' '(^|/)\\.git/config$' > /tmp/exclude-paths.txt && trufflehog "$@" 2>&1`,
        '--',
        'filesystem',
        '/scan/repo',
        '--json',
        '--no-update',
        '--concurrency',
        '8',
        '--exclude-paths',
        '/tmp/exclude-paths.txt',
      ],
      timeoutSeconds: 600,
    };

    const wrapped = wrapCommandForOutput(runner);

    expect(wrapped.command).toEqual(['sh']);
    expect(wrapped.args[0]).toBe('-c');
    expect(wrapped.args[1]).toContain(`trufflehog "$@" 2>&1`);
    expect(wrapped.args[2]).toBe('--');
    expect(wrapped.args.slice(3)).toEqual([
      'filesystem',
      '/scan/repo',
      '--json',
      '--no-update',
      '--concurrency',
      '8',
      '--exclude-paths',
      '/tmp/exclude-paths.txt',
    ]);
  });
});

describe('buildGcsFuseMountOptions', () => {
  it('keeps read-only mounts minimal', () => {
    expect(buildGcsFuseMountOptions('tenant/run/input', true)).toBe(
      'implicit-dirs,only-dir=tenant/run/input',
    );
  });

  it('adds non-root friendly ownership and mode flags for writable mounts', () => {
    expect(buildGcsFuseMountOptions('tenant/run/output', false)).toBe(
      'implicit-dirs,only-dir=tenant/run/output,uid=65532,gid=65532,file-mode=0666,dir-mode=0777',
    );
  });
});
