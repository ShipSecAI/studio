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
    delete process.env.CHAT_AI_BASE_URL;
    delete process.env.CHAT_AI_API_KEY;
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
    expect(runnerCall.image).toBe('ghcr.io/anomalyco/opencode:latest');
    expect(runnerCall.network).toBe('host');
    expect(runnerCall.env.OPENAI_API_KEY).toBe('sk-test');
    expect(runnerCall.env.OPENCODE_MODEL).toBe('openai/gpt-4o');
  });

  it('should mount local OpenCode auth for OpenCode Go models', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-opencode-go',
      componentRef: 'test-ref-opencode-go',
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

    await component.execute(
      {
        inputs: {
          task: 'Find the bug',
          model: { provider: 'opencode-go', modelId: 'deepseek-v4-flash' },
        },
        params: {
          opencodeAuthHostPath: '/Users/example/.local/share/opencode/auth.json',
        },
      },
      context as any,
    );

    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.env.OPENAI_API_KEY).toBeUndefined();
    expect(runnerCall.env.OPENCODE_MODEL).toBe('opencode-go/deepseek-v4-flash');
    expect(runnerCall.volumes).toContainEqual({
      source: '/Users/example/.local/share/opencode/auth.json',
      target: '/opencode-auth/auth.json',
      readOnly: true,
    });
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
    const opencodeIdx = runScript.indexOf('opencode -m "$OPENCODE_MODEL" run');
    expect(pluginIdx).toBeLessThan(opencodeIdx);

    // Should log plugin activation
    expect(context.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Plugins will be installed'),
    );
  });

  it('should expose Hotplug as CLI-native tool access when a session is attached', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-hotplug-cli',
      componentRef: 'test-ref-hotplug-cli',
      metadata: {
        connectedToolNodeIds: ['tool-1'],
        organizationId: 'org-1',
        hotplugMcpUrl: 'http://hotplug:10010/sessions/test-session/mcp',
        hotplugMcpToken: 'test-hotplug-token',
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
      task: 'Link findings using tools',
      model: { provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-test' },
    };

    await component.execute({ inputs, params: {} }, context as any);

    const volumeInstance = (createIsolatedVolume as any).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];
    expect(initCall['opencode.jsonc']).not.toContain('workflow-tools');
    expect(initCall['prompt.txt']).toContain('shipsec-tools list');
    expect(initCall['prompt.txt']).toContain('shipsec-tools candidates 200 open unassessed');
    expect(initCall['tools/README.md']).toContain('shipsec-tools call');
    expect(initCall['tools/README.md']).toContain('shipsec-tools candidates 200 open unassessed');
    expect(initCall['tools/shipsec-tools']).toContain('shipsec-tools list');
    expect(initCall['tools/shipsec-tools']).toContain(
      'shipsec-studio__list_finding_assessment_candidates',
    );

    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.env.HOTPLUG_MCP_URL).toBe('http://hotplug:10010/sessions/test-session/mcp');
    expect(runnerCall.env.HOTPLUG_MCP_TOKEN).toBe('test-hotplug-token');
    expect(initCall['run.sh']).not.toContain('hotplug mcp init');
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
