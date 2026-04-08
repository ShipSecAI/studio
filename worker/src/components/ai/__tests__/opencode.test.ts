import { describe, it, expect, vi, beforeEach, afterAll } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import * as SDK from '@shipsec/component-sdk'; // Import for spying
import { createIsolatedVolume } from '../../../utils/isolated-volume';
import '../opencode'; // Register the component

// Mock createIsolatedVolume
vi.mock('../../../utils/isolated-volume', () => {
  return {
    createIsolatedVolume: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue('mock-volume-name'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getVolumeConfig: vi
        .fn()
        .mockReturnValue({ source: 'mock', target: '/workspace', readOnly: false }),
      getVolumeName: vi.fn().mockReturnValue('mock-volume-name'),
    })),
  };
});

describe('shipsec.opencode.agent', () => {
  let runSpy: any;
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envSnapshot };
    delete process.env.BIFROST_BASE_URL;
    delete process.env.BIFROST_API_KEY;

    // Spy on runComponentWithRunner
    runSpy = vi.spyOn(SDK, 'runComponentWithRunner').mockResolvedValue({
      stdout: '# Report\n\nInvestigation complete.',
      stderr: '',
      exitCode: 0,
      results: [],
      raw: '',
    } as any);
  });

  afterAll(() => {
    process.env = envSnapshot;
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.ai.opencode');
    expect(component).toBeDefined();
    expect(component?.id).toBe('core.ai.opencode');
  });

  it('should execute with valid inputs', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run',
      componentRef: 'test-ref',
      metadata: {
        connectedToolNodeIds: ['tool-1'],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Find the bug',
      context: { alertId: '123' },
      model: { provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-test' },
    };

    const params = {
      systemPrompt: 'You are a detective.',
      autoApprove: true,
    };

    const result = await component.execute({ inputs, params }, context as any);

    expect(result.report).toContain('# Report');

    expect(createIsolatedVolume).toHaveBeenCalled();
    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    expect(initCall['context.json']).toContain('"alertId": "123"');
    expect(initCall['opencode.jsonc']).toContain('"model": "openai/gpt-4o"');

    expect(runSpy).toHaveBeenCalled();
    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.image).toBe('ghcr.io/shipsecai/opencode:latest');
    expect(runnerCall.network).toBe('host');
    expect(runnerCall.env.OPENAI_API_KEY).toBe('sk-test');
  });

  it('should merge providerConfig into opencode.jsonc', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-config',
      componentRef: 'test-ref-config',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Test config merge',
    };

    const params = {
      providerConfig: {
        githubToken: 'gh-token',
        extraSetting: 123,
      },
    };

    await component.execute({ inputs, params }, context as any);

    expect(createIsolatedVolume).toHaveBeenCalled();
    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    const config = JSON.parse(initCall['opencode.jsonc']);
    expect(config.githubToken).toBe('gh-token');
    expect(config.extraSetting).toBe(123);
  });

  it('should include plugin setup in wrapper script when enablePlugins is set', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-plugins',
      componentRef: 'test-ref-plugins',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Review this PR',
    };

    const params = {
      enablePlugins: ['oh-my-opencode'],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    // Should contain oh-my-opencode install command
    expect(runScript).toContain('oh-my-opencode install');
    expect(runScript).toContain('--no-tui');

    // Plugin setup should appear BEFORE opencode run
    const pluginIdx = runScript.indexOf('oh-my-opencode install');
    const opencodeIdx = runScript.indexOf('opencode run');
    expect(pluginIdx).toBeLessThan(opencodeIdx);

    // Should log plugin activation
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Plugins will be installed'),
    );
  });

  it('should not include plugin setup when enablePlugins is empty', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-no-plugins',
      componentRef: 'test-ref-no-plugins',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Review this PR',
    };

    const params = {
      enablePlugins: [],
    };

    await component.execute({ inputs, params }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    const runScript = initCall['run.sh'] as string;

    // Should NOT contain any plugin setup
    expect(runScript).not.toContain('oh-my-opencode install');
    expect(runScript).not.toContain('Plugin Installation');
  });
});
