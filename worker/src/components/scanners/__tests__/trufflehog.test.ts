import { beforeAll, afterEach, describe, expect, it, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('scanner.trufflehog component', () => {
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.EXECUTION_MODE = originalEnv.EXECUTION_MODE;
    process.env.GCS_VOLUME_BUCKET = originalEnv.GCS_VOLUME_BUCKET;
  });

  it('should not pass --results flag when onlyVerified is false', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {
        onlyVerified: false,
      },
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command.some((arg) => arg.startsWith('--results='))).toBe(false);
  });

  it('should pass --results=verified when onlyVerified is true', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {
        onlyVerified: true,
      },
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command).toContain('--results=verified');
  });

  it('should use shell wrapper command and append dynamic args', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {},
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[]; entrypoint?: string };
    const command = runnerConfig.command ?? [];

    expect(runnerConfig.entrypoint).toBe('sh');
    expect(command[0]).toBe('-c');
    expect(command[1]).toContain('trufflehog "$@" 2>&1');
    expect(command).toContain('filesystem');
    expect(command).toContain('/scan/repo');
  });

  it('should parse numeric DetectorType using DetectorName without throwing', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {},
    };

    const rawOutput = [
      JSON.stringify({
        SourceMetadata: { Data: { Filesystem: { file: '/scan/repo/.git/config', line: 7 } } },
        DetectorType: 8,
        DetectorName: 'Github',
        Verified: false,
        Raw: 'ghs_example',
        Redacted: '',
      }),
    ].join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(rawOutput);

    const output = (await component.execute(executePayload, context)) as {
      findingCount: number;
      findings: {
        type?: string;
        secret_type?: string;
        severity?: string;
      }[];
    };

    expect(output.findingCount).toBe(1);
    expect(output.findings[0]?.type).toBe('Github');
    expect(output.findings[0]?.secret_type).toBe('Github');
    expect(output.findings[0]?.severity).toBe('medium');
  });

  it('should always include --exclude-paths for .git/config', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {},
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];

    // Should have --exclude-paths pointing to the exclude file
    const excludeIdx = command.indexOf('--exclude-paths');
    expect(excludeIdx).toBeGreaterThan(-1);
    expect(command[excludeIdx + 1]).toBe('/tmp/exclude-paths.txt');

    // Shell script should write the exclude file with the .git/config regex
    const shellScript = command[1] as string;
    expect(shellScript).toContain("printf '%s\\n' '(^|/)\\.git/config$' > /tmp/exclude-paths.txt");
  });

  it('should write exclude-paths and include-paths when changedFiles provided', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
        changedFiles: ['src/app.ts', 'README.md'],
      },
      params: {},
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];

    // Should have both exclude-paths and include-paths
    expect(command).toContain('--exclude-paths');
    expect(command).toContain('--include-paths');

    // Shell script should write exclude file before include file
    const shellScript = command[1] as string;
    expect(shellScript).toContain("printf '%s\\n' '(^|/)\\.git/config$' > /tmp/exclude-paths.txt");
    expect(shellScript).toContain('/tmp/include-paths.txt');
    expect(shellScript).toContain('trufflehog "$@" 2>&1');
  });

  it('should resolve raw k8s volume names to gcsfuse sources', async () => {
    process.env.EXECUTION_MODE = 'k8s';
    process.env.GCS_VOLUME_BUCKET = 'shipsec-volumes-staging';

    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          volumeName: 'shipsec-run-abc/shipsec-run-abc/123',
        },
        params: {},
      },
      context,
    );

    const runnerConfig = spy.mock.calls[0]?.[0] as {
      volumes?: { source: string; target: string; readOnly: boolean }[];
    };

    expect(runnerConfig.volumes?.[0]).toEqual({
      source: 'gcsfuse:shipsec-volumes-staging:shipsec-run-abc/shipsec-run-abc/123',
      target: '/scan',
      readOnly: true,
    });
  });

  it('should ignore non-finding status JSON lines', async () => {
    const component = componentRegistry.get('scanner.trufflehog');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-scanner-test',
    });

    const executePayload = {
      inputs: {
        volumeName: 'test-volume',
      },
      params: {},
    };

    const rawOutput = [
      JSON.stringify({ level: 'info-0', msg: 'running source', trufflehog_version: '3.93.1' }),
      JSON.stringify({
        SourceMetadata: {
          Data: { Filesystem: { file: '/scan/repo/fake-aws-tokens.txt', line: 2 } },
        },
        DetectorType: 2,
        DetectorName: 'AWS',
        Verified: false,
        Raw: 'AKIAEXAMPLE',
      }),
    ].join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(rawOutput);

    const output = (await component.execute(executePayload, context)) as {
      findingCount: number;
      findings: {
        type?: string;
        severity?: string;
      }[];
    };

    expect(output.findingCount).toBe(1);
    expect(output.findings[0]?.type).toBe('AWS');
    expect(output.findings[0]?.severity).toBe('high');
  });
});
