import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { TruffleHogInput, TruffleHogOutput } from '../trufflehog';

describe('trufflehog component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    expect(component).toBeDefined();
    expect(component!.label).toBe('TruffleHog');
    expect(component!.category).toBe('security');
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('trufflesecurity/trufflehog:v3.92.1');
    }
  });

  it('should parse input with default values', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
    });

    expect(params.scanTarget).toBe('https://github.com/test/repo');
    expect(params.scanType).toBe('git');
    expect(params.onlyVerified).toBe(true);
    expect(params.jsonOutput).toBe(true);
  });

  it('should handle JSON output with secrets', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
    });

    const mockOutput = {
      secrets: [
        {
          DetectorType: 'AWS',
          DetectorName: 'AWS',
          Verified: true,
          Raw: 'AKIAIOSFODNN7EXAMPLE',
          SourceMetadata: {
            Data: {
              Git: {
                commit: 'abc123',
                file: 'config.yml',
                repository: 'test/repo',
              },
            },
          },
        },
      ],
      rawOutput: '{"DetectorType":"AWS","Verified":true}',
      secretCount: 1,
      verifiedCount: 1,
      hasVerifiedSecrets: true,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(params, context);

    expect(result.secretCount).toBe(1);
    expect(result.verifiedCount).toBe(1);
    expect(result.hasVerifiedSecrets).toBe(true);
    expect(result.secrets).toHaveLength(1);
  });

  it('should handle no secrets found', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/clean-repo',
      scanType: 'git',
    });

    const mockOutput = {
      secrets: [],
      rawOutput: '',
      secretCount: 0,
      verifiedCount: 0,
      hasVerifiedSecrets: false,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(params, context);

    expect(result.secretCount).toBe(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.hasVerifiedSecrets).toBe(false);
    expect(result.secrets).toHaveLength(0);
  });

  it('should support different scan types', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const gitParams = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
    });
    expect(gitParams.scanType).toBe('git');

    const filesystemParams = component.inputSchema.parse({
      scanTarget: '/path/to/files',
      scanType: 'filesystem',
    });
    expect(filesystemParams.scanType).toBe('filesystem');

    const s3Params = component.inputSchema.parse({
      scanTarget: 'my-bucket',
      scanType: 's3',
    });
    expect(s3Params.scanType).toBe('s3');

    const dockerParams = component.inputSchema.parse({
      scanTarget: 'myimage:latest',
      scanType: 'docker',
    });
    expect(dockerParams.scanType).toBe('docker');
  });

  it('should accept optional git parameters', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
      branch: 'main',
      sinceCommit: 'HEAD~10',
    });

    expect(params.branch).toBe('main');
    expect(params.sinceCommit).toBe('HEAD~10');
  });

  it('should accept custom flags', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
      customFlags: '--fail --concurrency=8',
    });

    expect(params.customFlags).toBe('--fail --concurrency=8');
  });

  it('should handle unverified secrets when onlyVerified is false', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
      onlyVerified: false,
    });

    const mockOutput = {
      secrets: [
        {
          DetectorType: 'Generic',
          Verified: false,
          Raw: 'potential_secret_123',
        },
        {
          DetectorType: 'AWS',
          Verified: true,
          Raw: 'AKIAIOSFODNN7EXAMPLE',
        },
      ],
      rawOutput: 'raw output',
      secretCount: 2,
      verifiedCount: 1,
      hasVerifiedSecrets: true,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(params, context);

    expect(result.secretCount).toBe(2);
    expect(result.verifiedCount).toBe(1);
    expect(result.hasVerifiedSecrets).toBe(true);
  });

  it('should handle parse errors gracefully', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('invalid json output');

    const result = await component.execute(params, context);

    expect(result.secretCount).toBe(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.hasVerifiedSecrets).toBe(false);
    expect(result.rawOutput).toBe('invalid json output');
  });

  it('should accept filesystemContent parameter', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({
      scanTarget: '/scan',
      scanType: 'filesystem',
      filesystemContent: {
        'config.yaml': 'api_key: AKIAIOSFODNN7EXAMPLE',
        'app.py': 'password = "secret123"',
      },
    });

    expect(params.filesystemContent).toBeDefined();
    expect(Object.keys(params.filesystemContent!)).toHaveLength(2);
    expect(params.filesystemContent!['config.yaml']).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('should reject filesystemContent with non-filesystem scanType', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
      filesystemContent: {
        'file.txt': 'content',
      },
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      'filesystemContent can only be used with scanType=filesystem'
    );
  });

  it('should propagate exit code 183 when secrets found with --fail flag', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
      customFlags: '--fail',
    });

    const error = new Error('Container exited with code 183');
    vi.spyOn(sdk, 'runComponentWithRunner').mockRejectedValue(error);

    await expect(component.execute(params, context)).rejects.toThrow('Container exited with code 183');
  });

  it('should propagate other error exit codes', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>('shipsec.trufflehog.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const params = component.inputSchema.parse({
      scanTarget: 'https://github.com/test/repo',
      scanType: 'git',
    });

    const error = new Error('Container exited with code 1: auth failed');
    vi.spyOn(sdk, 'runComponentWithRunner').mockRejectedValue(error);

    await expect(component.execute(params, context)).rejects.toThrow('auth failed');
  });
});
