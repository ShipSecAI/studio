import { beforeAll, afterEach, describe, expect, it, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('scanner.trufflehog component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
