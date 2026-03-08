import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { TruffleHogInput, TruffleHogOutput } from '../trufflehog';
import * as toolOutput from '../../../utils/tool-output';

let mockToolOutput = '';

describe('trufflehog component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  beforeEach(() => {
    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
  });

  afterEach(() => {
    mockToolOutput = '';
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    expect(component).toBeDefined();
    expect(component!.label).toBe('TruffleHog');
    expect(component!.category).toBe('security');
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('trufflesecurity/trufflehog:latest');
    }
  });

  it('should parse input with default values', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const inputValues = {
      scanTarget: 'https://github.com/test/repo',
    };
    const paramValues = {
      scanType: 'git' as const,
    };

    const parsedInputs = component.inputs.parse(inputValues);
    const parsedParams = component.parameters!.parse(paramValues);

    expect(parsedInputs.scanTarget).toBe('https://github.com/test/repo');
    expect(parsedParams.scanType).toBe('git');
    expect(parsedParams.onlyVerified).toBe(true);
    expect(parsedParams.jsonOutput).toBe(true);
  });

  it('should handle JSON output with secrets', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
      },
    };

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
      results: [
        {
          DetectorType: 'AWS',
          DetectorName: 'AWS',
          Verified: true,
          Raw: 'AKIAIOSFODNN7EXAMPLE',
          scanner: 'trufflehog',
          severity: 'high',
          finding_hash: 'abc123def456abcd',
          asset_key: 'https://github.com/test/repo',
        },
      ],
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    mockToolOutput = JSON.stringify(mockOutput);
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(executePayload, context);

    expect(result.secretCount).toBe(1);
    expect(result.verifiedCount).toBe(1);
    expect(result.hasVerifiedSecrets).toBe(true);
    expect(result.secrets).toHaveLength(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].scanner).toBe('trufflehog');
    expect(result.results[0].severity).toBe('high');
  });

  it('should handle no secrets found', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/clean-repo',
      },
      params: {
        scanType: 'git' as const,
      },
    };

    const mockOutput = {
      secrets: [],
      rawOutput: '',
      secretCount: 0,
      verifiedCount: 0,
      hasVerifiedSecrets: false,
      results: [],
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    mockToolOutput = JSON.stringify(mockOutput);
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(executePayload, context);

    expect(result.secretCount).toBe(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.hasVerifiedSecrets).toBe(false);
    expect(result.secrets).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  it('should support different scan types', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const gitParams = component.parameters!.parse({ scanType: 'git' });
    expect(gitParams.scanType).toBe('git');

    const filesystemParams = component.parameters!.parse({ scanType: 'filesystem' });
    expect(filesystemParams.scanType).toBe('filesystem');

    const s3Params = component.parameters!.parse({ scanType: 's3' });
    expect(s3Params.scanType).toBe('s3');

    const dockerParams = component.parameters!.parse({ scanType: 'docker' });
    expect(dockerParams.scanType).toBe('docker');
  });

  it('should accept optional git parameters', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const params = component.parameters!.parse({
      scanType: 'git',
      branch: 'main',
      sinceCommit: 'HEAD~10',
    });

    expect(params.branch).toBe('main');
    expect(params.sinceCommit).toBe('HEAD~10');
  });

  it('should accept custom flags', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const params = component.parameters!.parse({
      scanType: 'git',
      customFlags: '--fail --concurrency=8',
    });

    expect(params.customFlags).toBe('--fail --concurrency=8');
  });

  it('should handle unverified secrets when onlyVerified is false', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: false,
      },
    };

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
      results: [
        {
          DetectorType: 'Generic',
          Verified: false,
          Raw: 'potential_secret_123',
          scanner: 'trufflehog',
          severity: 'high',
          finding_hash: 'def456abc789def0',
          asset_key: 'https://github.com/test/repo',
        },
        {
          DetectorType: 'AWS',
          Verified: true,
          Raw: 'AKIAIOSFODNN7EXAMPLE',
          scanner: 'trufflehog',
          severity: 'high',
          finding_hash: 'abc123def456abcd',
          asset_key: 'https://github.com/test/repo',
        },
      ],
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    mockToolOutput = JSON.stringify(mockOutput);
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(JSON.stringify(mockOutput));

    const result = await component.execute(executePayload, context);

    expect(result.secretCount).toBe(2);
    expect(result.verifiedCount).toBe(1);
    expect(result.hasVerifiedSecrets).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('should not pass --results flag when onlyVerified is false', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: false,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command.some((arg) => arg.startsWith('--results='))).toBe(false);
  });

  it('should pass --results=verified when onlyVerified is true', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: true,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command).toContain('--results=verified');
  });

  it('should not pass --results flag when onlyVerified is false', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: false,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command.some((arg) => arg.startsWith('--results='))).toBe(false);
  });

  it('should pass --results=verified when onlyVerified is true', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: true,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command).toContain('--results=verified');
  });

  it('should not pass --results flag when onlyVerified is false', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: false,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command.some((arg) => arg.startsWith('--results='))).toBe(false);
  });

  it('should pass --results=verified when onlyVerified is true', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        onlyVerified: true,
      },
    };

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        secrets: [],
        rawOutput: '',
        secretCount: 0,
        verifiedCount: 0,
        hasVerifiedSecrets: false,
      }),
    );

    await component.execute(executePayload, context);

    const runnerConfig = spy.mock.calls[0]?.[0] as { command?: string[] };
    const command = runnerConfig.command ?? [];
    expect(command).toContain('--results=verified');
  });

  it('should handle parse errors gracefully', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    vi.spyOn(toolOutput, 'readToolOutputFile').mockImplementation(async () => mockToolOutput);
    mockToolOutput = 'invalid json output';
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('invalid json output');

    const result = await component.execute(executePayload, context);

    expect(result.secretCount).toBe(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.hasVerifiedSecrets).toBe(false);
    expect(result.rawOutput).toBe('invalid json output');
  });

  it('should accept filesystemContent parameter', () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const params = component.parameters!.parse({
      scanType: 'filesystem',
      filesystemContent: {
        'config.yaml': 'api_key: AKIAIOSFODNN7EXAMPLE',
        'app.py': 'password = "secret123"',
      },
    });

    expect(params.filesystemContent).toBeDefined();
    expect(Object.keys(params.filesystemContent!)).toHaveLength(2);
    expect((params.filesystemContent as any)['config.yaml']).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('should reject filesystemContent with non-filesystem scanType', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        filesystemContent: {
          'file.txt': 'content',
        },
      },
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'filesystemContent can only be used with scanType=filesystem',
    );
  });

  it('should propagate exit code 183 when secrets found with --fail flag', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
        customFlags: '--fail',
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    const error = { message: 'Container exited with code 183' };
    vi.spyOn(sdk, 'runComponentWithRunner').mockRejectedValue(error as any);

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'Container exited with code 183',
    );
  });

  it('should propagate other error exit codes', async () => {
    const component = componentRegistry.get<TruffleHogInput, TruffleHogOutput>(
      'shipsec.trufflehog.scan',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'trufflehog-test',
    });

    const executePayload = {
      inputs: {
        scanTarget: 'https://github.com/test/repo',
      },
      params: {
        scanType: 'git' as const,
      },
    };

    vi.spyOn(toolOutput, 'createToolOutputVolume').mockResolvedValue({
      getVolumeConfig: () => ({ source: 'mock-output', target: '/tool-output', readOnly: false }),
      cleanup: async () => {},
    } as any);
    const error = { message: 'Container exited with code 1: auth failed' };
    vi.spyOn(sdk, 'runComponentWithRunner').mockRejectedValue(error as any);

    await expect(component.execute(executePayload, context)).rejects.toThrow('auth failed');
  });
});
